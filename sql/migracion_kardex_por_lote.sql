-- Ejecutar después de las migraciones de actas, Kardex, cantidades y seguridad.
begin;

alter table public.kardex_movimientos add column if not exists kardex_lote_id text;
alter table public.kardex_movimientos add column if not exists kardex_identidad jsonb;

create or replace function public.fn_identidad_kardex_lote(
    p_acta uuid, p_producto uuid, p_lote text, p_vencimiento date, p_snapshot jsonb
) returns jsonb language sql stable set search_path = '' as $$
    select jsonb_build_object(
        'producto_id', p_producto, 'lote', nullif(btrim(p_lote), ''),
        'fecha_venc', to_char(p_vencimiento, 'YYYY-MM-DD'),
        'fabricante', nullif(btrim(p_snapshot->>'fabricante'), ''),
        'procedencia', nullif(btrim(p_snapshot->>'procedencia'), ''),
        'reg_sanitario', nullif(btrim(p_snapshot->>'reg_sanitario'), ''),
        -- Si falta un dato histórico, mantener el registro separado por acta.
        'acta_sin_identidad_completa', case when nullif(btrim(p_lote), '') is null
            or p_vencimiento is null or nullif(btrim(p_snapshot->>'fabricante'), '') is null
            or nullif(btrim(p_snapshot->>'procedencia'), '') is null
            or nullif(btrim(p_snapshot->>'reg_sanitario'), '') is null then p_acta end
    );
$$;

create or replace function public.fn_clave_kardex_lote(p_identidad jsonb)
returns text language sql immutable strict set search_path = '' as $$
    select encode(sha256(convert_to(p_identidad::text, 'UTF8')), 'hex');
$$;

create index if not exists idx_kardex_lote_orden
    on public.kardex_movimientos(kardex_lote_id, created_at, id);

-- Rellena el historial conservando las actas, cantidades y metadatos originales.
with identidades as (
    select k.id, public.fn_identidad_kardex_lote(k.recepcion_id, k.producto_id, k.lote, k.fecha_venc,
        (select d.producto_snapshot from public.recepcion_detalle d
         where d.recepcion_id = k.recepcion_id and d.producto_id = k.producto_id
           and d.lote is not distinct from k.lote and d.fecha_venc is not distinct from k.fecha_venc
         order by d.id limit 1)) as identidad
    from public.kardex_movimientos k
    where k.recepcion_id is not null and k.kardex_lote_id is null
)
update public.kardex_movimientos k
set kardex_identidad = i.identidad, kardex_lote_id = public.fn_clave_kardex_lote(i.identidad)
from identidades i where k.id = i.id;

create or replace function public.fn_calcular_saldo_kardex()
returns trigger language plpgsql security invoker set search_path = public as $$
declare
    v_total numeric;
    v_ultimo timestamptz;
begin
    if new.recepcion_id is null then raise exception 'Selecciona el acta de origen del Kardex'; end if;
    if not ((coalesce(new.ingreso,0) > 0 and coalesce(new.salida,0) = 0) or
            (coalesce(new.salida,0) > 0 and coalesce(new.ingreso,0) = 0)) then
        raise exception 'Ingreso y salida deben ser cantidades positivas y excluyentes';
    end if;
    perform 1 from recepciones where id = new.recepcion_id for update;
    if not found then raise exception 'El acta no existe'; end if;
    perform 1 from productos where id = new.producto_id for update;
    if not found then raise exception 'El producto no existe'; end if;

    if new.ingreso > 0 then
        select fn_identidad_kardex_lote(d.recepcion_id, d.producto_id, d.lote, d.fecha_venc, d.producto_snapshot)
        into new.kardex_identidad
        from recepcion_detalle d
        where d.recepcion_id = new.recepcion_id and d.producto_id = new.producto_id
          and d.lote is not distinct from new.lote and d.fecha_venc is not distinct from new.fecha_venc
        order by d.id limit 1;
    else
        select k.kardex_identidad into new.kardex_identidad
        from kardex_movimientos k
        where k.recepcion_id = new.recepcion_id and k.producto_id = new.producto_id and k.ingreso > 0
          and k.lote is not distinct from new.lote and k.fecha_venc is not distinct from new.fecha_venc
        order by k.created_at, k.id limit 1;
        if exists (select 1 from kardex_movimientos where producto_id = new.producto_id
                   and recepcion_id is null and salida > 0) then
            raise exception 'Asigna primero las salidas anteriores de este producto';
        end if;
    end if;
    if new.kardex_identidad is null then raise exception 'El lote no pertenece al acta seleccionada'; end if;
    new.kardex_lote_id := fn_clave_kardex_lote(new.kardex_identidad);

    select coalesce(sum(coalesce(ingreso,0)-coalesce(salida,0)),0), max(created_at) into v_total, v_ultimo
    from kardex_movimientos where kardex_lote_id = new.kardex_lote_id;
    if new.salida > 0 and new.salida > v_total then
        raise exception 'Stock insuficiente. Disponible: % unidades.', greatest(v_total,0);
    end if;
    new.saldo := v_total + coalesce(new.ingreso,0) - coalesce(new.salida,0);
    new.created_at := greatest(clock_timestamp(), v_ultimo + interval '1 microsecond');
    update productos set stock = (select coalesce(sum(coalesce(ingreso,0)-coalesce(salida,0)),0)
        from kardex_movimientos where producto_id = new.producto_id)
        + coalesce(new.ingreso,0) - coalesce(new.salida,0) where id = new.producto_id;
    return new;
end;
$$;

create or replace function public.fn_recalcular_kardex_producto(p_producto_id uuid)
returns void language plpgsql set search_path = public as $$
begin
    perform 1 from productos where id = p_producto_id for update;
    update kardex_movimientos k set saldo = x.saldo
    from (select id, sum(coalesce(ingreso,0)-coalesce(salida,0)) over (
        partition by kardex_lote_id order by created_at,id rows unbounded preceding) as saldo
        from kardex_movimientos where producto_id = p_producto_id) x
    where k.id = x.id and k.saldo is distinct from x.saldo;
    update productos set stock = (select coalesce(sum(coalesce(ingreso,0)-coalesce(salida,0)),0)
        from kardex_movimientos where producto_id = p_producto_id) where id = p_producto_id;
end;
$$;

create or replace function public.fn_validar_existencias_kardex()
returns trigger language plpgsql security invoker set search_path = public as $$
declare v_producto uuid := case when tg_op = 'DELETE' then old.producto_id else new.producto_id end;
begin
    if exists (select 1 from kardex_movimientos where producto_id = v_producto
        and kardex_lote_id is not null group by kardex_lote_id
        having sum(coalesce(ingreso,0)-coalesce(salida,0)) < 0) then
        raise exception 'El cambio dejaría stock negativo en un lote';
    end if;
    return null;
end;
$$;

create or replace function public.fn_validar_edicion_kardex()
returns trigger language plpgsql set search_path = public as $$
declare
    v_eliminar_lote boolean := tg_op = 'DELETE' and
        current_setting('sgde.eliminar_lote',true) = old.kardex_lote_id;
    v_edicion_acta boolean := current_setting('sgde.edicion_acta',true) = 'on';
    v_eliminar_acta boolean := tg_op = 'DELETE' and current_setting('sgde.eliminar_kardex',true)
        = old.recepcion_id::text || ':' || old.producto_id::text;
begin
    if v_eliminar_lote or v_edicion_acta or v_eliminar_acta then
        if exists (select 1 from kardex_movimientos where salida > 0 and
            (kardex_lote_id = old.kardex_lote_id or (v_edicion_acta and recepcion_id = old.recepcion_id))) then
            raise exception 'El Kardex tiene salidas registradas: no se puede reconstruir ni eliminar su ingreso';
        end if;
        if tg_op = 'DELETE' then return old; end if;
    end if;
    if old.recepcion_id is not null and old.ingreso > 0 then
        raise exception 'El ingreso pertenece a un acta: edítalo desde Recepción';
    end if;
    if tg_op = 'UPDATE' then
        if new.producto_id is distinct from old.producto_id or new.lote is distinct from old.lote
            or new.fecha_venc is distinct from old.fecha_venc then
            raise exception 'No se puede cambiar el producto, el lote ni el vencimiento de un movimiento';
        end if;
        if old.recepcion_id is null and new.recepcion_id is not null
           and current_setting('sgde.asignar_salida',true) = 'on' then
            select k.kardex_identidad, k.kardex_lote_id into new.kardex_identidad, new.kardex_lote_id
            from kardex_movimientos k where k.recepcion_id = new.recepcion_id and k.producto_id = new.producto_id
                and k.ingreso > 0 and k.lote is not distinct from new.lote and k.fecha_venc is not distinct from new.fecha_venc
            order by k.created_at,k.id limit 1;
            if new.kardex_lote_id is null then raise exception 'El lote no pertenece al acta seleccionada'; end if;
        elsif new.recepcion_id is distinct from old.recepcion_id or new.kardex_lote_id is distinct from old.kardex_lote_id
            or new.kardex_identidad is distinct from old.kardex_identidad then
            raise exception 'No se puede cambiar el Kardex de un movimiento';
        end if;
        if old.salida > 0 and (coalesce(new.ingreso,0) <> 0 or coalesce(new.salida,0) <= 0) then
            raise exception 'Una salida debe conservar ingreso cero y cantidad positiva';
        end if;
    end if;
    return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists trg_validar_edicion_kardex on public.kardex_movimientos;
-- Se instala después del relleno para permitir mapear los movimientos históricos.
create trigger trg_validar_edicion_kardex
before update of producto_id, recepcion_id, fecha, guia_numero, proveedor_cliente, lote, fecha_venc,
    ingreso, salida, observaciones, kardex_lote_id, kardex_identidad or delete on public.kardex_movimientos
for each row execute function public.fn_validar_edicion_kardex();

create or replace view public.kardex_por_lote with (security_invoker = true) as
with origenes as (
    select distinct k.kardex_lote_id, r.id, r.guia_numero, r.fecha
    from public.kardex_movimientos k join public.recepciones r on r.id = k.recepcion_id
    where k.ingreso > 0 and k.kardex_lote_id is not null
), lotes as (
    select k.kardex_lote_id, k.producto_id, k.kardex_identidad,
        sum(coalesce(k.ingreso,0)-coalesce(k.salida,0)) as stock
    from public.kardex_movimientos k where k.kardex_lote_id is not null
    group by k.kardex_lote_id, k.producto_id, k.kardex_identidad
)
select l.kardex_lote_id as id, l.producto_id, l.kardex_identidad->>'lote' as lote,
    l.kardex_identidad->>'fecha_venc' as fecha_venc,
    to_jsonb(p) || jsonb_build_object('fabricante', l.kardex_identidad->'fabricante',
        'procedencia', l.kardex_identidad->'procedencia', 'reg_sanitario', l.kardex_identidad->'reg_sanitario') as producto,
    l.stock, p.stock as stock_producto, o.actas,
    (select count(*) from public.kardex_movimientos h where h.producto_id = l.producto_id
        and h.recepcion_id is null and h.salida > 0) as salidas_pendientes
from lotes l join public.productos p on p.id = l.producto_id
join (select kardex_lote_id, jsonb_agg(jsonb_build_object('id',id,'guia',guia_numero,'fecha',fecha)
        order by fecha,id) as actas from origenes group by kardex_lote_id) o on o.kardex_lote_id = l.kardex_lote_id;

revoke all on public.kardex_por_lote from public, anon;
grant select on public.kardex_por_lote to authenticated, service_role;

create or replace function public.consultar_lote_kardex(p_kardex_id text)
returns table(lote text, fecha_venc date, disponible numeric, recepcion_id uuid)
language sql stable security invoker set search_path = public as $$
    select origen.lote, origen.fecha_venc, lote.stock, origen.recepcion_id
    from kardex_por_lote lote
    cross join lateral (
        select k.lote, k.fecha_venc, k.recepcion_id from kardex_movimientos k
        where k.kardex_lote_id=lote.id and k.ingreso>0
        order by k.created_at,k.id limit 1
    ) origen
    where lote.id=p_kardex_id and lote.stock>0 and lote.salidas_pendientes=0;
$$;

revoke all on function public.consultar_lote_kardex(text) from public, anon;
grant execute on function public.consultar_lote_kardex(text) to authenticated, service_role;

create or replace function public.asignar_salida_acta(p_movimiento_id uuid, p_recepcion_id uuid, p_usuario text)
returns void language plpgsql set search_path = public as $$
declare v_mov kardex_movimientos%rowtype; v_grupo text; v_disponible numeric;
begin
    if not exists(select 1 from usuarios where username=p_usuario and activo and rol in ('admin','asistente')) then
        raise exception 'El usuario no tiene permiso';
    end if;
    perform 1 from recepciones where id=p_recepcion_id for update;
    if not found then raise exception 'El acta no existe'; end if;
    select * into strict v_mov from kardex_movimientos where id=p_movimiento_id;
    perform 1 from productos where id=v_mov.producto_id for update;
    select * into strict v_mov from kardex_movimientos where id=p_movimiento_id for update;
    if v_mov.recepcion_id is not null or coalesce(v_mov.salida,0)<=0 or coalesce(v_mov.ingreso,0)<>0 then
        raise exception 'El movimiento no es una salida pendiente de asignar';
    end if;
    select k.kardex_lote_id into v_grupo from kardex_movimientos k
    where k.recepcion_id=p_recepcion_id and k.producto_id=v_mov.producto_id and k.ingreso>0
        and k.lote is not distinct from v_mov.lote and k.fecha_venc is not distinct from v_mov.fecha_venc
    order by k.created_at,k.id limit 1;
    if v_grupo is null then raise exception 'El lote no pertenece al acta seleccionada'; end if;
    select coalesce(sum(coalesce(ingreso,0)-coalesce(salida,0)),0) into v_disponible
    from kardex_movimientos where kardex_lote_id=v_grupo;
    if v_mov.salida>v_disponible then
        raise exception 'Stock insuficiente en el Kardex. Disponible: % unidades.', v_disponible;
    end if;
    perform set_config('sgde.asignar_salida','on',true);
    update kardex_movimientos set recepcion_id=p_recepcion_id where id=p_movimiento_id;
    perform set_config('sgde.asignar_salida','off',true);
    perform fn_recalcular_kardex_producto(v_mov.producto_id);
    insert into log_auditoria(usuario,accion,tabla,registro_id,detalle)
    values(p_usuario,'UPDATE','kardex_movimientos',p_movimiento_id::text,
        format('Asignación de salida anterior al acta %s y al Kardex %s',p_recepcion_id,v_grupo));
end;
$$;

create or replace function public.eliminar_kardex_lote(p_kardex_id text, p_usuario text)
returns void language plpgsql security invoker set search_path = public as $$
declare v_producto uuid; v_actas uuid[]; v_movimientos jsonb; v_detalles jsonb;
begin
    if not exists(select 1 from usuarios where username=p_usuario and activo and rol in ('admin','asistente')) then
        raise exception 'El usuario no tiene permiso para eliminar Kardex';
    end if;
    select producto_id into v_producto from kardex_movimientos where kardex_lote_id=p_kardex_id limit 1;
    if v_producto is null then raise exception 'El Kardex ya no existe'; end if;
    select array_agg(distinct recepcion_id order by recepcion_id) into v_actas
        from kardex_movimientos where kardex_lote_id=p_kardex_id;
    perform 1 from recepciones where id=any(v_actas) order by id for update;
    perform 1 from productos where id=v_producto for update;
    if v_actas is distinct from (select array_agg(distinct recepcion_id order by recepcion_id)
        from kardex_movimientos where kardex_lote_id=p_kardex_id) then
        raise exception 'Las actas del Kardex cambiaron. Actualiza la lista y reintenta.';
    end if;
    if exists(select 1 from kardex_movimientos where producto_id=v_producto and salida>0
        and (kardex_lote_id=p_kardex_id or recepcion_id is null)) then
        raise exception 'El Kardex tiene salidas registradas o pendientes de asignar';
    end if;
    perform set_config('sgde.eliminar_lote',p_kardex_id,true);
    with borrados as (
        delete from kardex_movimientos where kardex_lote_id=p_kardex_id returning *
    ) select jsonb_agg(to_jsonb(b)) into v_movimientos from borrados b;
    perform set_config('sgde.eliminar_lote','',true);
    with borrados as (
        delete from recepcion_detalle d where d.recepcion_id=any(v_actas) and d.producto_id=v_producto
            and fn_clave_kardex_lote(fn_identidad_kardex_lote(
                d.recepcion_id,d.producto_id,d.lote,d.fecha_venc,d.producto_snapshot))=p_kardex_id
        returning *
    ) select jsonb_agg(to_jsonb(b)) into v_detalles from borrados b;
    delete from recepciones r where r.id=any(v_actas)
        and not exists(select 1 from recepcion_detalle d where d.recepcion_id=r.id)
        and not exists(select 1 from kardex_movimientos k where k.recepcion_id=r.id);
    perform fn_recalcular_kardex_producto(v_producto);
    perform fn_sincronizar_catalogo_acta(v_producto);
    insert into log_auditoria(usuario,accion,tabla,registro_id,detalle)
    values(p_usuario,'DELETE','kardex_movimientos',p_kardex_id,
        jsonb_build_object('accion','Eliminar Kardex por lote','actas',v_actas,'producto',v_producto,
            'movimientos_eliminados',v_movimientos,'detalles_eliminados',v_detalles)::text);
end;
$$;

revoke all on function public.eliminar_kardex_lote(text,text) from public, anon;
grant execute on function public.eliminar_kardex_lote(text,text) to authenticated, service_role;

do $$ declare v_id uuid; begin
    for v_id in select distinct producto_id from public.kardex_movimientos where producto_id is not null loop
        perform public.fn_recalcular_kardex_producto(v_id);
    end loop;
end $$;

notify pgrst, 'reload schema';
commit;
