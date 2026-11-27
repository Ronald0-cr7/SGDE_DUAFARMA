-- Ejecutar después de las migraciones de actas y Kardex.
begin;

create or replace function public.fn_validar_cantidades_acta()
returns trigger language plpgsql set search_path = '' as $$
begin
    if new.cant_solicitada is null or new.cant_recibida is null
        or new.cant_solicitada not between 1 and 9007199254740991
        or new.cant_recibida not between 1 and 9007199254740991
        or new.cant_solicitada <> trunc(new.cant_solicitada)
        or new.cant_recibida <> trunc(new.cant_recibida) then
        raise exception 'Las cantidades solicitadas y recibidas deben ser enteras mayores que cero';
    end if;
    return new;
end;
$$;

drop trigger if exists validar_cantidades_acta on public.recepcion_detalle;
create trigger validar_cantidades_acta
before insert or update of cant_solicitada, cant_recibida on public.recepcion_detalle
for each row execute function public.fn_validar_cantidades_acta();

create or replace function public.fn_validar_cantidades_kardex()
returns trigger language plpgsql set search_path = '' as $$
begin
    if tg_op = 'UPDATE' and new.ingreso is not distinct from old.ingreso
        and new.salida is not distinct from old.salida then
        return new;
    end if;
    if new.ingreso is null or new.salida is null
        or new.ingreso not between 0 and 9007199254740991
        or new.salida not between 0 and 9007199254740991
        or new.ingreso <> trunc(new.ingreso) or new.salida <> trunc(new.salida)
        or (new.ingreso = 0) = (new.salida = 0) then
        raise exception 'El movimiento debe tener un ingreso o una salida de unidades enteras mayores que cero';
    end if;
    return new;
end;
$$;

drop trigger if exists validar_cantidades_kardex on public.kardex_movimientos;
create trigger validar_cantidades_kardex
before insert or update of ingreso, salida on public.kardex_movimientos
for each row execute function public.fn_validar_cantidades_kardex();

commit;
