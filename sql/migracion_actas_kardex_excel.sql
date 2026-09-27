-- ============================================================
-- ACTAS MULTIPRODUCTO + KARDEX VINCULADO
-- Ejecuta este archivo UNA VEZ en el SQL Editor de Supabase.
-- Es una migracion: conserva todos los registros existentes.
-- ============================================================

alter table productos add column if not exists concentracion_forma text;
alter table productos add column if not exists condicion_almacen text default 'T° Ambiente Controlada';

alter table recepciones add column if not exists transportista_nombre text;
alter table recepciones add column if not exists entrega_inicio timestamptz;
alter table recepciones add column if not exists entrega_termino timestamptz;
alter table recepciones add column if not exists recibido_por text;
alter table recepciones add column if not exists recepcion_inicio timestamptz;
alter table recepciones add column if not exists recepcion_termino timestamptz;
alter table recepciones add column if not exists director_tecnico text;

alter table recepcion_detalle add column if not exists producto_snapshot jsonb default '{}'::jsonb;

alter table kardex_movimientos add column if not exists recepcion_id uuid
    references recepciones(id) on delete set null;

create index if not exists idx_recepcion_detalle_recepcion on recepcion_detalle(recepcion_id);
create index if not exists idx_kardex_producto_fecha on kardex_movimientos(producto_id, created_at);
create index if not exists idx_kardex_recepcion on kardex_movimientos(recepcion_id);

-- Registra cabecera, todos los detalles y sus movimientos de Kardex
-- dentro de una sola transaccion. Si algo falla, no queda un acta incompleta.
create or replace function registrar_recepcion_completa(p_cabecera jsonb, p_detalles jsonb)
returns uuid
language plpgsql
as $$
declare
    v_recepcion_id uuid;
    v_detalle jsonb;
    v_producto productos%rowtype;
begin
    if jsonb_array_length(coalesce(p_detalles, '[]'::jsonb)) = 0 then
        raise exception 'El acta debe contener al menos un producto';
    end if;

    insert into recepciones (
        fecha, guia_numero, proveedor, tipo_ingreso, usuario_registro,
        transportista_nombre, entrega_inicio, entrega_termino,
        recibido_por, recepcion_inicio, recepcion_termino, director_tecnico
    ) values (
        coalesce(nullif(p_cabecera->>'fecha', '')::date, current_date),
        nullif(p_cabecera->>'guia_numero', ''),
        nullif(p_cabecera->>'proveedor', ''),
        nullif(p_cabecera->>'tipo_ingreso', ''),
        p_cabecera->>'usuario_registro',
        nullif(p_cabecera->>'transportista_nombre', ''),
        nullif(p_cabecera->>'entrega_inicio', '')::timestamptz,
        nullif(p_cabecera->>'entrega_termino', '')::timestamptz,
        nullif(p_cabecera->>'recibido_por', ''),
        nullif(p_cabecera->>'recepcion_inicio', '')::timestamptz,
        nullif(p_cabecera->>'recepcion_termino', '')::timestamptz,
        nullif(p_cabecera->>'director_tecnico', '')
    ) returning id into v_recepcion_id;

    for v_detalle in select value from jsonb_array_elements(p_detalles)
    loop
        select * into strict v_producto
        from productos
        where id = (v_detalle->>'producto_id')::uuid;

        if coalesce((v_detalle->>'cant_recibida')::numeric, 0) <= 0 then
            raise exception 'La cantidad recibida debe ser mayor que cero';
        end if;

        insert into recepcion_detalle (
            recepcion_id, producto_id, lote, fecha_venc,
            cant_solicitada, cant_recibida, estado_embalaje, producto_snapshot
        ) values (
            v_recepcion_id,
            v_producto.id,
            nullif(v_detalle->>'lote', ''),
            nullif(v_detalle->>'fecha_venc', '')::date,
            coalesce((v_detalle->>'cant_solicitada')::numeric, 0),
            (v_detalle->>'cant_recibida')::numeric,
            coalesce(nullif(v_detalle->>'estado_embalaje', ''), 'CONFORME'),
            jsonb_build_object(
                'codigo', v_producto.codigo,
                'nombre', v_producto.nombre,
                'presentacion', v_producto.presentacion,
                'concentracion_forma', v_producto.concentracion_forma,
                'fabricante', v_producto.fabricante,
                'procedencia', v_producto.procedencia,
                'reg_sanitario', v_producto.reg_sanitario,
                'condicion_almacen', v_producto.condicion_almacen,
                'dam', v_producto.dam
            )
        );

        insert into kardex_movimientos (
            recepcion_id, producto_id, fecha, guia_numero, proveedor_cliente,
            lote, fecha_venc, ingreso, salida, realizado_por, verificado_por, observaciones
        ) values (
            v_recepcion_id,
            v_producto.id,
            coalesce(nullif(p_cabecera->>'fecha', '')::date, current_date),
            nullif(p_cabecera->>'guia_numero', ''),
            nullif(p_cabecera->>'proveedor', ''),
            nullif(v_detalle->>'lote', ''),
            nullif(v_detalle->>'fecha_venc', '')::date,
            (v_detalle->>'cant_recibida')::numeric,
            0,
            nullif(p_cabecera->>'recibido_por', ''),
            nullif(p_cabecera->>'director_tecnico', ''),
            coalesce(nullif(v_detalle->>'estado_embalaje', ''), 'CONFORME')
        );
    end loop;

    return v_recepcion_id;
end;
$$;

-- Completa los campos nuevos de los productos de demostracion cuando coinciden.
update productos set
    concentracion_forma = case codigo
        when 'D00031' then '150 MG/ML ACETATO DE MEDROXIPROGESTERONA - SUSPENSIÓN'
        when 'D00035' then '1.5 MG LEVONORGESTREL - TABLETA COMPRIMIDA'
        else concentracion_forma end,
    condicion_almacen = coalesce(condicion_almacen, 'T° Ambiente Controlada')
where codigo in ('D00031', 'D00035');
