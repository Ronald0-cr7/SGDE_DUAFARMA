-- Ejecutar en Supabase SQL Editor antes de habilitar la edición del Kardex.
-- Recalcula saldos y stock en la misma transacción de cada cambio.

create or replace function fn_recalcular_kardex_producto(p_producto_id uuid)
returns void language plpgsql as $$
declare
    v_saldo numeric := 0;
    v_movimiento record;
begin
    if p_producto_id is null then return; end if;
    -- Serializa los cambios de un mismo producto.
    perform 1 from productos where id = p_producto_id for update;
    for v_movimiento in
        select id, coalesce(ingreso, 0) as ingreso, coalesce(salida, 0) as salida
        from kardex_movimientos
        where producto_id = p_producto_id
        order by created_at, id
    loop
        v_saldo := v_saldo + v_movimiento.ingreso - v_movimiento.salida;
        update kardex_movimientos set saldo = v_saldo where id = v_movimiento.id;
    end loop;
    update productos set stock = v_saldo where id = p_producto_id;
end;
$$;

create or replace function fn_validar_edicion_kardex()
returns trigger language plpgsql as $$
begin
    if old.recepcion_id is not null then
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

drop trigger if exists trg_validar_edicion_kardex on kardex_movimientos;
create trigger trg_validar_edicion_kardex
before update of producto_id, recepcion_id, fecha, guia_numero, proveedor_cliente,
    lote, fecha_venc, ingreso, salida, observaciones or delete
on kardex_movimientos for each row execute function fn_validar_edicion_kardex();

create or replace function fn_actualizar_saldos_kardex()
returns trigger language plpgsql as $$
begin
    perform fn_recalcular_kardex_producto(old.producto_id);
    return null;
end;
$$;

drop trigger if exists trg_actualizar_saldos_kardex on kardex_movimientos;
create trigger trg_actualizar_saldos_kardex
after update of ingreso, salida or delete
on kardex_movimientos for each row execute function fn_actualizar_saldos_kardex();
