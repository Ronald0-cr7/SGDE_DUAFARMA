-- Ejecutar después de migracion_kardex_por_acta.sql.
-- Conserva el usuario real en log_auditoria y la fecha del movimiento.
begin;

create or replace function public.registrar_salida_kardex(p_id uuid, p_usuario text, p_registro jsonb)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
    v_usuario usuarios%rowtype;
    v_mov kardex_movimientos%rowtype;
    v_producto uuid := (p_registro->>'producto_id')::uuid;
    v_cantidad numeric := (p_registro->>'salida')::numeric;
begin
    select * into v_usuario from usuarios where username = p_usuario and activo = true;
    if not found or v_usuario.rol not in ('admin','asistente') then
        raise exception 'El usuario no tiene permiso para registrar salidas';
    end if;
    if nullif(p_registro->>'recepcion_id','') is null or p_id is null or v_producto is null or
       nullif(btrim(p_registro->>'fecha'),'') is null or
       nullif(btrim(p_registro->>'proveedor_cliente'),'') is null or
       nullif(btrim(p_registro->>'tipo_doc'),'') is null or
       nullif(btrim(p_registro->>'num_doc'),'') is null then
        raise exception 'Completa producto, fecha, cliente y documento';
    end if;
    if v_cantidad is null or v_cantidad <= 0 or v_cantidad::text in ('NaN','Infinity','-Infinity') then
        raise exception 'La cantidad retirada debe ser mayor que cero y finita';
    end if;
    if nullif(btrim(p_registro->>'realizado_por'),'') is null or
       nullif(btrim(p_registro->>'verificado_por'),'') is null then
        raise exception 'Completa Realizado por y Verificado por';
    end if;
    -- Serializa reintentos, incluso si se cambia accidentalmente el producto.
    perform pg_advisory_xact_lock(hashtextextended(p_id::text, 0));
    select * into v_mov from kardex_movimientos where id = p_id;
    if found then
        if v_mov.recepcion_id is distinct from (p_registro->>'recepcion_id')::uuid or v_mov.producto_id is distinct from v_producto or v_mov.salida is distinct from v_cantidad
           or not exists(select 1 from log_auditoria where registro_id=p_id::text and tabla='kardex_movimientos' and accion='INSERT' and usuario=p_usuario) then
            raise exception 'El identificador ya corresponde a otro movimiento';
        end if;
        return jsonb_build_object('id', v_mov.id, 'saldo', v_mov.saldo);
    end if;
    insert into kardex_movimientos (
        id, recepcion_id, producto_id, fecha, guia_numero, tipo_doc, num_doc, fecha_doc,
        proveedor_cliente, lote, fecha_venc, ingreso, salida, realizado_por, verificado_por, observaciones
    ) values (
        p_id, (p_registro->>'recepcion_id')::uuid, v_producto, (p_registro->>'fecha')::date,
        case when p_registro->>'tipo_doc' = 'Guía de remisión' then btrim(p_registro->>'num_doc') else null end,
        case when p_registro->>'tipo_doc' = 'Guía de remisión' then null else btrim(p_registro->>'tipo_doc') end,
        case when p_registro->>'tipo_doc' = 'Guía de remisión' then null else btrim(p_registro->>'num_doc') end,
        case when p_registro->>'tipo_doc' = 'Guía de remisión' then null else (p_registro->>'fecha')::date end,
        btrim(p_registro->>'proveedor_cliente'), p_registro->>'lote',
        nullif(p_registro->>'fecha_venc','')::date, 0, v_cantidad,
        btrim(p_registro->>'realizado_por'), btrim(p_registro->>'verificado_por'),
        nullif(btrim(p_registro->>'observaciones'),'')
    ) returning * into v_mov;
    insert into log_auditoria(usuario, accion, tabla, registro_id, detalle)
    values (p_usuario, 'INSERT', 'kardex_movimientos', v_mov.id::text,
        format('Salida: acta %s; producto %s; lote %s; vencimiento %s; cantidad %s; saldo %s; cliente %s; documento %s %s; fecha %s',
            v_mov.recepcion_id, v_producto, v_mov.lote, v_mov.fecha_venc, v_cantidad, v_mov.saldo,
            v_mov.proveedor_cliente, v_mov.tipo_doc, v_mov.num_doc, v_mov.fecha));
    return jsonb_build_object('id', v_mov.id, 'saldo', v_mov.saldo);
end;
$$;

notify pgrst, 'reload schema';
commit;
