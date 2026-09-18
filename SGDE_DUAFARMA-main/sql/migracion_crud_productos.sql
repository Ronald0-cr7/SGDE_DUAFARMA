-- CRUD DEL CATÁLOGO DE PRODUCTOS
-- Ejecutar una vez en el SQL Editor de Supabase.
-- Los datos históricos de lote/vencimiento continúan en recepcion_detalle.

alter table productos add column if not exists lote text;
alter table productos add column if not exists fecha_venc date;
alter table productos add column if not exists estado_embalaje text default 'CONFORME';

update productos
set condicion_almacen = 'T° Ambiente Controlada'
where condicion_almacen is null or condicion_almacen in ('TÂ° Ambiente Controlada', '');

update productos
set estado_embalaje = 'CONFORME'
where estado_embalaje is null or estado_embalaje = '';

-- Mantiene en el catálogo los datos del lote recibido más recientemente.
-- El historial completo permanece en recepcion_detalle y no se sobrescribe.
create or replace function fn_actualizar_producto_desde_recepcion()
returns trigger
language plpgsql
as $$
begin
    update productos
    set lote = new.lote,
        fecha_venc = new.fecha_venc,
        estado_embalaje = coalesce(new.estado_embalaje, 'CONFORME')
    where id = new.producto_id;
    return new;
end;
$$;

drop trigger if exists trg_actualizar_producto_desde_recepcion on recepcion_detalle;
create trigger trg_actualizar_producto_desde_recepcion
after insert or update of lote, fecha_venc, estado_embalaje on recepcion_detalle
for each row execute function fn_actualizar_producto_desde_recepcion();
