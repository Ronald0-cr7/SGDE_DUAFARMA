-- Ejecutar después de las migraciones de actas y cantidades enteras.
begin;

create or replace function public.fn_validar_cabecera_acta()
returns trigger language plpgsql set search_path = '' as $$
declare
    -- Las horas del acta se guardan en UTC con los componentes del formulario.
    inicio timestamp := new.recepcion_inicio at time zone 'UTC';
    termino timestamp := new.recepcion_termino at time zone 'UTC';
begin
    if new.fecha is null or nullif(btrim(new.guia_numero), '') is null
        or nullif(btrim(new.proveedor), '') is null
        or new.tipo_ingreso is null or new.tipo_ingreso not in ('COMPRA LOCAL', 'IMPORTACIÓN', 'OTROS')
        or nullif(btrim(new.transportista_nombre), '') is null
        or nullif(btrim(new.recibido_por), '') is null
        or new.entrega_inicio is null or new.entrega_termino is null
        or inicio is null or termino is null then
        raise exception 'Acta incompleta. Completa todos los campos obligatorios.';
    end if;
    if extract(isodow from new.fecha) = 7 then
        raise exception 'Fecha no permitida. Registra el acta de lunes a sábado.';
    end if;
    if inicio::date <> new.fecha or termino::date <> new.fecha then
        raise exception 'La fecha del acta, el inicio y el término de recepción deben coincidir.';
    end if;
    if inicio::time not between time '08:00' and time '13:00'
        or termino::time not between time '08:00' and time '13:00' then
        raise exception 'El inicio y el término de recepción deben estar entre las 08:00 y las 13:00.';
    end if;
    if termino < inicio or new.entrega_termino < new.entrega_inicio then
        raise exception 'El término de entrega o recepción no puede ser anterior a su inicio.';
    end if;
    return new;
end;
$$;

drop trigger if exists validar_cabecera_acta on public.recepciones;
create trigger validar_cabecera_acta
before insert or update of fecha, guia_numero, proveedor, tipo_ingreso, transportista_nombre,
    entrega_inicio, entrega_termino, recibido_por, recepcion_inicio, recepcion_termino
on public.recepciones for each row execute function public.fn_validar_cabecera_acta();

create or replace function public.fn_validar_detalle_acta()
returns trigger language plpgsql set search_path = '' as $$
begin
    if new.producto_id is null or nullif(btrim(new.lote), '') is null or new.fecha_venc is null
        or new.estado_embalaje is null or new.estado_embalaje not in ('CONFORME', 'NO CONFORME') then
        raise exception 'Acta incompleta. Cada producto requiere lote, vencimiento y estado del embalaje.';
    end if;
    return new;
end;
$$;

drop trigger if exists validar_detalle_acta on public.recepcion_detalle;
create trigger validar_detalle_acta
before insert or update of producto_id, lote, fecha_venc, estado_embalaje
on public.recepcion_detalle for each row execute function public.fn_validar_detalle_acta();

commit;
