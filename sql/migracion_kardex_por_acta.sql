-- Ejecutar DESPUÉS de migracion_salidas_kardex.sql.
-- Conserva movimientos y cantidades; recalcula saldos por acta y producto.
begin;

drop function if exists public.consultar_lotes_kardex(uuid);
create or replace function public.consultar_lotes_kardex(p_producto_id uuid, p_recepcion_id uuid)
returns table(lote text, fecha_venc date, disponible numeric)
language sql stable security invoker set search_path = public as $$
    select k.lote, k.fecha_venc, sum(coalesce(k.ingreso,0)-coalesce(k.salida,0))
    from kardex_movimientos k where k.producto_id = p_producto_id and k.recepcion_id = p_recepcion_id
    group by k.lote, k.fecha_venc
    having sum(coalesce(k.ingreso,0)-coalesce(k.salida,0)) > 0
    order by k.fecha_venc nulls last, k.lote nulls last;
$$;

-- Todos los ingresos y salidas comparten el bloqueo del producto.
-- El saldo se calcula solo con movimientos de la misma acta y producto.
create or replace function public.fn_calcular_saldo_kardex()
returns trigger language plpgsql security invoker set search_path = public as $$
declare
    v_total numeric;
    v_lote numeric;
    v_ultimo timestamptz;
begin
    if new.recepcion_id is null then
        raise exception 'Selecciona el acta de origen del Kardex';
    end if;
    perform 1 from recepciones where id = new.recepcion_id for update;
    if not found then raise exception 'El acta no existe'; end if;
    if not exists (select 1 from recepcion_detalle where recepcion_id = new.recepcion_id and producto_id = new.producto_id) then
        raise exception 'El producto no pertenece al acta seleccionada';
    end if;
    perform 1 from productos where id = new.producto_id for update;
    if not found then raise exception 'El producto no existe'; end if;
    new.ingreso := coalesce(new.ingreso,0);
    new.salida := coalesce(new.salida,0);
    if new.ingreso::text in ('NaN','Infinity','-Infinity') or
       new.salida::text in ('NaN','Infinity','-Infinity') or
       new.ingreso < 0 or new.salida < 0 or (new.ingreso > 0 and new.salida > 0) then
        raise exception 'Ingreso y salida deben ser cantidades válidas y excluyentes';
    end if;
    select coalesce(sum(coalesce(ingreso,0)-coalesce(salida,0)),0), max(created_at)
      into v_total, v_ultimo from kardex_movimientos where producto_id = new.producto_id and recepcion_id = new.recepcion_id;
    if new.salida > 0 then
        if exists(select 1 from kardex_movimientos where producto_id = new.producto_id and recepcion_id is null and salida > 0) then
            raise exception 'Asigna primero las salidas anteriores de este producto a sus actas';
        end if;
        select coalesce(sum(coalesce(ingreso,0)-coalesce(salida,0)),0) into v_lote
        from kardex_movimientos where producto_id = new.producto_id and recepcion_id = new.recepcion_id
          and lote is not distinct from new.lote and fecha_venc is not distinct from new.fecha_venc;
        if new.salida > least(v_total,v_lote) then
            raise exception 'Stock insuficiente. Disponible: % unidades.', greatest(least(v_total,v_lote),0);
        end if;
    end if;
    new.saldo := v_total + new.ingreso - new.salida;
    -- Orden de registro estable incluso con transacciones que empezaron antes de esperar.
    new.created_at := greatest(clock_timestamp(), v_ultimo + interval '1 microsecond');
    update productos set stock = (select coalesce(sum(coalesce(ingreso,0)-coalesce(salida,0)),0)
        from kardex_movimientos where producto_id = new.producto_id) + new.ingreso - new.salida
        where id = new.producto_id;
    return new;
end;
$$;

drop trigger if exists trg_saldo_kardex on public.kardex_movimientos;
create trigger trg_saldo_kardex before insert on public.kardex_movimientos
for each row execute function public.fn_calcular_saldo_kardex();

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
    -- Serializa reintentos, incluso si se cambia accidentalmente el producto.
    perform pg_advisory_xact_lock(hashtextextended(p_id::text, 0));
    select * into v_mov from kardex_movimientos where id = p_id;
    if found then
        if v_mov.recepcion_id is distinct from (p_registro->>'recepcion_id')::uuid or v_mov.producto_id is distinct from v_producto or v_mov.salida is distinct from v_cantidad
           or v_mov.realizado_por is distinct from p_usuario then
            raise exception 'El identificador ya corresponde a otro movimiento';
        end if;
        return jsonb_build_object('id', v_mov.id, 'saldo', v_mov.saldo);
    end if;
    insert into kardex_movimientos (
        id, recepcion_id, producto_id, fecha, guia_numero, tipo_doc, num_doc, fecha_doc,
        proveedor_cliente, lote, fecha_venc, ingreso, salida, realizado_por, observaciones
    ) values (
        p_id, (p_registro->>'recepcion_id')::uuid, v_producto, (p_registro->>'fecha')::date,
        nullif(btrim(p_registro->>'guia_numero'),''), btrim(p_registro->>'tipo_doc'),
        btrim(p_registro->>'num_doc'), (p_registro->>'fecha')::date,
        btrim(p_registro->>'proveedor_cliente'), p_registro->>'lote',
        nullif(p_registro->>'fecha_venc','')::date, 0, v_cantidad, p_usuario,
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

-- Las ediciones existentes también deben respetar las existencias por lote.
-- La comprobación diferida permite reconstruir un acta dentro de su transacción.
create or replace function public.fn_bloquear_producto_kardex()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
    perform 1 from productos where id = old.producto_id for update;
    return case when tg_op = 'DELETE' then old else new end;
end;
$$;
drop trigger if exists trg_bloquear_producto_kardex on kardex_movimientos;
create trigger trg_bloquear_producto_kardex before update or delete on kardex_movimientos
for each row execute function public.fn_bloquear_producto_kardex();

create or replace function public.fn_validar_existencias_kardex()
returns trigger language plpgsql security invoker set search_path = public as $$
declare v_producto uuid;
begin
    v_producto := case when tg_op = 'DELETE' then old.producto_id else new.producto_id end;
    if exists (select 1 from kardex_movimientos where producto_id = v_producto
        and (coalesce(ingreso,0) < 0 or coalesce(salida,0) < 0
            or ingreso::text in ('NaN','Infinity','-Infinity')
            or salida::text in ('NaN','Infinity','-Infinity')
            or (ingreso > 0 and salida > 0))) then
        raise exception 'Ingreso y salida deben ser cantidades válidas y excluyentes';
    end if;
    if exists (select 1 from kardex_movimientos where producto_id = v_producto
        and recepcion_id is not null group by recepcion_id, lote, fecha_venc having sum(coalesce(ingreso,0)-coalesce(salida,0)) < 0) then
        raise exception 'El cambio dejaría stock negativo en un lote';
    end if;
    return null;
end;
$$;
drop trigger if exists trg_validar_existencias_kardex on kardex_movimientos;
create constraint trigger trg_validar_existencias_kardex
after insert or update or delete on kardex_movimientos deferrable initially deferred
for each row execute function public.fn_validar_existencias_kardex();

create or replace function public.fn_recalcular_kardex_producto(p_producto_id uuid)
returns void language plpgsql set search_path = public as $$
begin
    perform 1 from productos where id = p_producto_id for update;
    update kardex_movimientos k set saldo = calculado.saldo
    from (select id, sum(coalesce(ingreso,0)-coalesce(salida,0)) over
        (partition by recepcion_id, producto_id order by created_at,id rows unbounded preceding) as saldo
        from kardex_movimientos where producto_id = p_producto_id) calculado
    where k.id = calculado.id;
    update productos set stock = (select coalesce(sum(coalesce(ingreso,0)-coalesce(salida,0)),0)
        from kardex_movimientos where producto_id = p_producto_id) where id = p_producto_id;
end;
$$;

create or replace function public.fn_validar_edicion_kardex()
returns trigger language plpgsql set search_path = public as $$
begin
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

create or replace function public.fn_proteger_acta_con_salidas()
returns trigger language plpgsql set search_path = public as $$
begin
    if exists(select 1 from kardex_movimientos where recepcion_id = old.id and salida > 0) then
        raise exception 'El acta tiene salidas registradas y no se puede eliminar';
    end if;
    return old;
end;
$$;
drop trigger if exists trg_proteger_acta_con_salidas on recepciones;
create trigger trg_proteger_acta_con_salidas before delete on recepciones
for each row execute function public.fn_proteger_acta_con_salidas();

-- El catálogo conserva el stock total; cada fila de esta vista es UN kardex.
create or replace view public.kardex_por_acta with (security_invoker = true) as
select r.id::text || ':' || p.id::text as id, r.id as recepcion_id, p.id as producto_id,
    r.guia_numero as acta_guia, r.fecha as acta_fecha, r.proveedor as acta_proveedor,
    to_jsonb(p) as producto,
    sum(coalesce(k.ingreso,0)-coalesce(k.salida,0)) as stock,
    (select count(*) from kardex_movimientos h where h.producto_id = p.id
        and h.recepcion_id is null and h.salida > 0) as salidas_pendientes
from kardex_movimientos k join recepciones r on r.id = k.recepcion_id
join productos p on p.id = k.producto_id
group by r.id,p.id;

create index if not exists idx_kardex_acta_producto_orden
on public.kardex_movimientos(recepcion_id,producto_id,created_at,id);

-- La migración conserva las salidas antiguas sin acta. Un operador elige su
-- origen explícitamente; no se reparten entre actas que compartan lote.
create or replace function public.asignar_salida_acta(p_movimiento_id uuid, p_recepcion_id uuid, p_usuario text)
returns void language plpgsql set search_path = public as $$
declare v_mov kardex_movimientos%rowtype; v_disponible numeric;
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
    select coalesce(sum(coalesce(ingreso,0)-coalesce(salida,0)),0) into v_disponible
    from kardex_movimientos where recepcion_id=p_recepcion_id and producto_id=v_mov.producto_id
        and lote is not distinct from v_mov.lote and fecha_venc is not distinct from v_mov.fecha_venc;
    if v_mov.salida>v_disponible then
        raise exception 'Stock insuficiente en el acta. Disponible: % unidades.',v_disponible;
    end if;
    perform set_config('sgde.asignar_salida','on',true);
    update kardex_movimientos set recepcion_id=p_recepcion_id where id=p_movimiento_id;
    perform set_config('sgde.asignar_salida','off',true);
    perform fn_recalcular_kardex_producto(v_mov.producto_id);
    insert into log_auditoria(usuario,accion,tabla,registro_id,detalle)
    values(p_usuario,'UPDATE','kardex_movimientos',p_movimiento_id::text,
        format('Asignación de salida anterior al acta %s; producto %s; cantidad %s',p_recepcion_id,v_mov.producto_id,v_mov.salida));
end;
$$;

-- Recalcula exclusivamente los saldos, conservando cantidades y movimientos.
do $$ declare v_id uuid; begin
    for v_id in select distinct producto_id from kardex_movimientos where producto_id is not null loop
        perform fn_recalcular_kardex_producto(v_id);
    end loop;
end $$;
notify pgrst, 'reload schema';
commit;
