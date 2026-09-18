-- Ejecutar DESPUÉS de migracion_edicion_kardex.sql.
-- Mantiene acta, detalle, Kardex y stock en una sola transacción.

create or replace function fn_validar_edicion_kardex()
returns trigger language plpgsql as $$
begin
    if old.recepcion_id is not null and current_setting('sgde.edicion_acta', true) is distinct from 'on' then
        raise exception 'El movimiento pertenece a un acta y no se puede modificar ni eliminar';
    end if;
    if tg_op = 'UPDATE' then
        if new.producto_id is distinct from old.producto_id or
           new.recepcion_id is distinct from old.recepcion_id then
            raise exception 'No se puede cambiar el producto ni el acta de un movimiento';
        end if;
        if coalesce(new.ingreso, 0) < 0 or coalesce(new.salida, 0) < 0 then
            raise exception 'Ingreso y salida deben ser no negativos';
        end if;
    end if;
    return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create or replace function fn_sincronizar_catalogo_acta(p_producto_id uuid)
returns void language plpgsql as $$
declare v_detalle record;
begin
    select d.lote, d.fecha_venc, d.estado_embalaje into v_detalle
    from recepcion_detalle d join recepciones r on r.id = d.recepcion_id
    where d.producto_id = p_producto_id
    order by r.created_at desc, d.id desc limit 1;
    if found then
        update productos set lote = v_detalle.lote, fecha_venc = v_detalle.fecha_venc,
            estado_embalaje = coalesce(v_detalle.estado_embalaje, 'CONFORME')
        where id = p_producto_id;
    else
        update productos set lote = null, fecha_venc = null,
            estado_embalaje = 'CONFORME' where id = p_producto_id;
    end if;
end;
$$;

create or replace function eliminar_acta_completa(p_recepcion_id uuid)
returns void language plpgsql as $$
declare v_producto uuid; v_productos uuid[];
begin
    perform 1 from recepciones where id = p_recepcion_id for update;
    if not found then raise exception 'El acta ya no existe'; end if;
    perform set_config('sgde.edicion_acta', 'on', true);
    select array_agg(distinct producto_id) into v_productos from (
        select producto_id from kardex_movimientos where recepcion_id = p_recepcion_id
        union select producto_id from recepcion_detalle where recepcion_id = p_recepcion_id
    ) afectados where producto_id is not null;
    delete from kardex_movimientos where recepcion_id = p_recepcion_id;
    delete from recepcion_detalle where recepcion_id = p_recepcion_id;
    delete from recepciones where id = p_recepcion_id;
    foreach v_producto in array coalesce(v_productos, '{}'::uuid[]) loop
        perform fn_recalcular_kardex_producto(v_producto);
        perform fn_sincronizar_catalogo_acta(v_producto);
        if (select stock from productos where id = v_producto) < 0 then
            raise exception 'La eliminación dejaría stock negativo para un producto';
        end if;
    end loop;
end;
$$;

create or replace function actualizar_acta_completa(p_recepcion_id uuid, p_cabecera jsonb, p_detalles jsonb)
returns void language plpgsql as $$
declare v_detalle jsonb; v_producto productos%rowtype; v_id uuid; v_productos uuid[];
begin
    if jsonb_array_length(coalesce(p_detalles, '[]'::jsonb)) = 0 then
        raise exception 'El acta debe contener al menos un producto';
    end if;
    perform 1 from recepciones where id = p_recepcion_id for update;
    if not found then raise exception 'El acta ya no existe'; end if;
    perform set_config('sgde.edicion_acta', 'on', true);
    select array_agg(distinct producto_id) into v_productos from (
        select producto_id from kardex_movimientos where recepcion_id = p_recepcion_id
        union select producto_id from recepcion_detalle where recepcion_id = p_recepcion_id
    ) afectados where producto_id is not null;
    delete from kardex_movimientos where recepcion_id = p_recepcion_id;
    delete from recepcion_detalle where recepcion_id = p_recepcion_id;
    update recepciones set
        fecha = (p_cabecera->>'fecha')::date,
        guia_numero = nullif(p_cabecera->>'guia_numero', ''),
        proveedor = nullif(p_cabecera->>'proveedor', ''),
        tipo_ingreso = nullif(p_cabecera->>'tipo_ingreso', ''),
        transportista_nombre = nullif(p_cabecera->>'transportista_nombre', ''),
        entrega_inicio = nullif(p_cabecera->>'entrega_inicio', '')::timestamptz,
        entrega_termino = nullif(p_cabecera->>'entrega_termino', '')::timestamptz,
        recibido_por = nullif(p_cabecera->>'recibido_por', ''),
        recepcion_inicio = nullif(p_cabecera->>'recepcion_inicio', '')::timestamptz,
        recepcion_termino = nullif(p_cabecera->>'recepcion_termino', '')::timestamptz,
        director_tecnico = nullif(p_cabecera->>'director_tecnico', '')
    where id = p_recepcion_id;
    for v_detalle in select value from jsonb_array_elements(p_detalles) loop
        select * into strict v_producto from productos
        where id = (v_detalle->>'producto_id')::uuid for update;
        if coalesce((v_detalle->>'cant_recibida')::numeric, 0) <= 0 then
            raise exception 'La cantidad recibida debe ser mayor que cero';
        end if;
        if v_productos is null or not v_producto.id = any(v_productos) then
            v_productos := array_append(v_productos, v_producto.id);
        end if;
        insert into recepcion_detalle (recepcion_id, producto_id, lote, fecha_venc,
            cant_solicitada, cant_recibida, estado_embalaje, producto_snapshot)
        values (p_recepcion_id, v_producto.id, nullif(v_detalle->>'lote', ''),
            nullif(v_detalle->>'fecha_venc', '')::date,
            coalesce((v_detalle->>'cant_solicitada')::numeric, 0),
            (v_detalle->>'cant_recibida')::numeric,
            coalesce(nullif(v_detalle->>'estado_embalaje', ''), 'CONFORME'),
            jsonb_build_object('codigo', v_producto.codigo, 'nombre', v_producto.nombre,
                'presentacion', v_producto.presentacion, 'concentracion_forma', v_producto.concentracion_forma,
                'fabricante', v_producto.fabricante, 'procedencia', v_producto.procedencia,
                'reg_sanitario', v_producto.reg_sanitario, 'condicion_almacen', v_producto.condicion_almacen,
                'dam', v_producto.dam));
        insert into kardex_movimientos (recepcion_id, producto_id, fecha, guia_numero,
            proveedor_cliente, lote, fecha_venc, ingreso, salida, realizado_por,
            verificado_por, observaciones)
        values (p_recepcion_id, v_producto.id, (p_cabecera->>'fecha')::date,
            nullif(p_cabecera->>'guia_numero', ''), nullif(p_cabecera->>'proveedor', ''),
            nullif(v_detalle->>'lote', ''), nullif(v_detalle->>'fecha_venc', '')::date,
            (v_detalle->>'cant_recibida')::numeric, 0,
            nullif(p_cabecera->>'recibido_por', ''), nullif(p_cabecera->>'director_tecnico', ''),
            coalesce(nullif(v_detalle->>'estado_embalaje', ''), 'CONFORME'));
    end loop;
    foreach v_id in array coalesce(v_productos, '{}'::uuid[]) loop
        perform fn_recalcular_kardex_producto(v_id);
        perform fn_sincronizar_catalogo_acta(v_id);
        if (select stock from productos where id = v_id) < 0 then
            raise exception 'La edición dejaría stock negativo para un producto';
        end if;
    end loop;
end;
$$;
