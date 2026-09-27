-- Ejecutar después de migracion_kardex_por_acta.sql.
begin;

create or replace function public.fn_validar_edicion_kardex()
returns trigger language plpgsql set search_path = public as $$
begin
    -- Excepción limitada al Kardex validado por eliminar_kardex_acta.
    if tg_op='DELETE' and current_setting('sgde.eliminar_kardex',true)
       = old.recepcion_id::text || ':' || old.producto_id::text then
        if exists(select 1 from kardex_movimientos where recepcion_id=old.recepcion_id
                  and producto_id=old.producto_id and salida>0) then
            raise exception 'Este Kardex tiene salidas registradas y no se puede eliminar';
        end if;
        return old;
    end if;
    if current_setting('sgde.edicion_acta',true) = 'on' and old.recepcion_id is not null
       and exists(select 1 from kardex_movimientos where recepcion_id = old.recepcion_id and salida > 0) then
        raise exception 'El acta tiene salidas registradas: no se puede reconstruir ni eliminar';
    end if;
    if old.recepcion_id is not null and old.ingreso > 0
       and current_setting('sgde.edicion_acta',true) is distinct from 'on' then
        raise exception 'El ingreso pertenece a un acta: edítalo desde Recepción';
    end if;
    if tg_op = 'UPDATE' then
        if new.producto_id is distinct from old.producto_id or
           (new.recepcion_id is distinct from old.recepcion_id and
            not (old.recepcion_id is null and current_setting('sgde.asignar_salida',true) = 'on')) then
            raise exception 'No se puede cambiar el producto ni el acta de un movimiento';
        end if;
        if old.salida > 0 and (coalesce(new.ingreso,0) <> 0 or coalesce(new.salida,0) <= 0) then
            raise exception 'Una salida debe conservar ingreso cero y cantidad positiva';
        end if;
    end if;
    return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create or replace function public.eliminar_kardex_acta(p_recepcion_id uuid, p_producto_id uuid, p_usuario text)
returns void language plpgsql security invoker set search_path = public as $$
declare v_movimientos jsonb; v_detalles jsonb; v_guia text; v_stock numeric;
begin
    if not exists(select 1 from usuarios where username=p_usuario and activo and rol in ('admin','asistente')) then
        raise exception 'El usuario no tiene permiso para eliminar Kardex';
    end if;
    select guia_numero into v_guia from recepciones where id=p_recepcion_id for update;
    if not found then raise exception 'El acta ya no existe'; end if;
    perform 1 from productos where id=p_producto_id for update;
    if not found then raise exception 'El producto ya no existe'; end if;
    if not exists(select 1 from kardex_movimientos where recepcion_id=p_recepcion_id and producto_id=p_producto_id) then
        raise exception 'El Kardex ya no existe';
    end if;
    if exists(select 1 from kardex_movimientos where recepcion_id=p_recepcion_id and producto_id=p_producto_id and salida>0) then
        raise exception 'Este Kardex tiene salidas registradas y no se puede eliminar';
    end if;
    if exists(select 1 from kardex_movimientos where producto_id=p_producto_id and recepcion_id is null and salida>0) then
        raise exception 'Asigna primero las salidas anteriores de este producto a sus actas';
    end if;
    select jsonb_agg(to_jsonb(k)) into v_movimientos from kardex_movimientos k
        where recepcion_id=p_recepcion_id and producto_id=p_producto_id;
    select jsonb_agg(to_jsonb(d)) into v_detalles from recepcion_detalle d
        where recepcion_id=p_recepcion_id and producto_id=p_producto_id;
    perform set_config('sgde.eliminar_kardex',p_recepcion_id::text || ':' || p_producto_id::text,true);
    delete from kardex_movimientos where recepcion_id=p_recepcion_id and producto_id=p_producto_id;
    perform set_config('sgde.eliminar_kardex','',true);
    delete from recepcion_detalle where recepcion_id=p_recepcion_id and producto_id=p_producto_id;
    if not exists(select 1 from recepcion_detalle where recepcion_id=p_recepcion_id)
       and not exists(select 1 from kardex_movimientos where recepcion_id=p_recepcion_id) then
        delete from recepciones where id=p_recepcion_id;
    end if;
    perform fn_recalcular_kardex_producto(p_producto_id);
    perform fn_sincronizar_catalogo_acta(p_producto_id);
    select stock into v_stock from productos where id=p_producto_id;
    if v_stock<0 then raise exception 'La eliminación dejaría stock negativo'; end if;
    insert into log_auditoria(usuario,accion,tabla,registro_id,detalle)
    values(p_usuario,'DELETE','kardex_movimientos',p_recepcion_id::text || ':' || p_producto_id::text,
        jsonb_build_object('accion','Eliminar Kardex por acta y producto','acta',p_recepcion_id,
        'guia',v_guia,'producto',p_producto_id,'stock_resultante',v_stock,
        'movimientos_eliminados',v_movimientos,'detalles_eliminados',v_detalles)::text);
end;
$$;

notify pgrst, 'reload schema';
commit;
