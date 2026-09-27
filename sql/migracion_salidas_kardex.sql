-- Ejecutar después de las migraciones de actas y edición del Kardex.
-- No borra movimientos ni modifica saldos históricos existentes.
begin;

create or replace function public.consultar_lotes_kardex(p_producto_id uuid)
returns table(lote text, fecha_venc date, disponible numeric)
language sql stable security invoker set search_path = public as $$
    select k.lote, k.fecha_venc, sum(coalesce(k.ingreso,0)-coalesce(k.salida,0))
    from kardex_movimientos k where k.producto_id = p_producto_id
    group by k.lote, k.fecha_venc
    having sum(coalesce(k.ingreso,0)-coalesce(k.salida,0)) > 0
    order by k.fecha_venc nulls last, k.lote nulls last;
$$;

-- Todos los ingresos y salidas comparten el bloqueo del producto.
-- Se suma el libro completo, sin depender de empates en created_at.
create or replace function public.fn_calcular_saldo_kardex()
returns trigger language plpgsql security invoker set search_path = public as $$
declare
    v_total numeric;
    v_lote numeric;
    v_ultimo timestamptz;
begin
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
      into v_total, v_ultimo from kardex_movimientos where producto_id = new.producto_id;
    if new.salida > 0 then
        select coalesce(sum(coalesce(ingreso,0)-coalesce(salida,0)),0) into v_lote
        from kardex_movimientos where producto_id = new.producto_id
          and lote is not distinct from new.lote and fecha_venc is not distinct from new.fecha_venc;
        if new.salida > least(v_total,v_lote) then
            raise exception 'Stock insuficiente. Disponible: % unidades.', greatest(least(v_total,v_lote),0);
        end if;
    end if;
    new.saldo := v_total + new.ingreso - new.salida;
    -- Orden de registro estable incluso con transacciones que empezaron antes de esperar.
    new.created_at := greatest(clock_timestamp(), v_ultimo + interval '1 microsecond');
    update productos set stock = new.saldo where id = new.producto_id;
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
    if p_id is null or v_producto is null or
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
        if v_mov.producto_id is distinct from v_producto or v_mov.salida is distinct from v_cantidad
           or v_mov.realizado_por is distinct from p_usuario then
            raise exception 'El identificador ya corresponde a otro movimiento';
        end if;
        return jsonb_build_object('id', v_mov.id, 'saldo', v_mov.saldo);
    end if;
    insert into kardex_movimientos (
        id, producto_id, fecha, guia_numero, tipo_doc, num_doc, fecha_doc,
        proveedor_cliente, lote, fecha_venc, ingreso, salida, realizado_por, observaciones
    ) values (
        p_id, v_producto, (p_registro->>'fecha')::date,
        nullif(btrim(p_registro->>'guia_numero'),''), btrim(p_registro->>'tipo_doc'),
        btrim(p_registro->>'num_doc'), (p_registro->>'fecha')::date,
        btrim(p_registro->>'proveedor_cliente'), p_registro->>'lote',
        nullif(p_registro->>'fecha_venc','')::date, 0, v_cantidad, p_usuario,
        nullif(btrim(p_registro->>'observaciones'),'')
    ) returning * into v_mov;
    insert into log_auditoria(usuario, accion, tabla, registro_id, detalle)
    values (p_usuario, 'INSERT', 'kardex_movimientos', v_mov.id::text,
        format('Salida: producto %s; lote %s; vencimiento %s; cantidad %s; saldo %s; cliente %s; documento %s %s; fecha %s',
            v_producto, v_mov.lote, v_mov.fecha_venc, v_cantidad, v_mov.saldo,
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
        group by lote, fecha_venc having sum(coalesce(ingreso,0)-coalesce(salida,0)) < 0) then
        raise exception 'El cambio dejaría stock negativo en un lote';
    end if;
    return null;
end;
$$;
drop trigger if exists trg_validar_existencias_kardex on kardex_movimientos;
create constraint trigger trg_validar_existencias_kardex
after insert or update or delete on kardex_movimientos deferrable initially deferred
for each row execute function public.fn_validar_existencias_kardex();

notify pgrst, 'reload schema';
commit;
