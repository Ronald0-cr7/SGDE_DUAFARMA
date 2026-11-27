-- Ejecutar después de las migraciones actuales del SGDE.
-- Solo la Edge Function (service_role) puede ejecutar estas operaciones.
create table if not exists public.sgde_backup_jobs (
    id uuid primary key,
    token_hash text not null,
    actor text not null,
    revision text not null,
    estado text not null default 'preparando' check (estado in ('preparando','completado')),
    created_at timestamptz not null default now(),
    expires_at timestamptz not null default now() + interval '4 hours'
);
create table if not exists public.sgde_backup_files (
    job_id uuid not null references public.sgde_backup_jobs(id),
    bucket text not null check (bucket in ('repositorios','documentos')),
    path text not null,
    sha256 text not null,
    object_revision text not null,
    bytes bigint not null check (bytes >= 0),
    primary key(job_id,bucket,path)
);
alter table public.sgde_backup_jobs enable row level security;
alter table public.sgde_backup_files enable row level security;
revoke all on public.sgde_backup_jobs, public.sgde_backup_files from public, anon, authenticated;
grant all on public.sgde_backup_jobs, public.sgde_backup_files to service_role;

create or replace function public.sgde_backup_object_revision(p_bucket text,p_path text)
returns text language sql security invoker set search_path = public as $$
    select md5(o.updated_at::text || coalesce(o.metadata::text,'')) from storage.objects o
    where o.bucket_id=p_bucket and o.name=p_path;
$$;
revoke all on function public.sgde_backup_object_revision(text,text) from public,anon,authenticated;
grant execute on function public.sgde_backup_object_revision(text,text) to service_role;

create or replace function public.sgde_backup_snapshot()
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
    v_tablas jsonb := '{}'::jsonb;
    v_esquema jsonb;
    v_filas jsonb;
    v_archivos jsonb;
    v_tabla text;
begin
    -- El bloqueo evita mezclar registros de operaciones concurrentes.
    lock table usuarios, productos, recepciones, recepcion_detalle,
        kardex_movimientos, documentos, log_auditoria, repositorios,
        carpetas, archivos_repositorio in share mode;
    foreach v_tabla in array array['usuarios','productos','recepciones',
        'recepcion_detalle','kardex_movimientos','documentos','log_auditoria',
        'repositorios','carpetas','archivos_repositorio'] loop
        -- Guardar cantidades como texto evita redondeos de NUMERIC/bigint
        -- al pasar por JSON.parse en JavaScript. PostgreSQL recupera sus tipos.
        execute format('select coalesce(jsonb_agg((select jsonb_object_agg(e.key,
            case when jsonb_typeof(e.value) = ''number'' then to_jsonb(e.value #>> ''{}'')
            else e.value end) from jsonb_each(to_jsonb(t)) e) order by t.id), ''[]''::jsonb)
            from public.%I t',v_tabla) into v_filas;
        v_tablas := v_tablas || jsonb_build_object(v_tabla,v_filas);
    end loop;
    select jsonb_agg(jsonb_build_object('tabla',table_name,'columna',column_name,
        'tipo',udt_name,'nullable',is_nullable) order by table_name,ordinal_position)
    into v_esquema from information_schema.columns
    where table_schema='public' and table_name = any(array['usuarios','productos',
        'recepciones','recepcion_detalle','kardex_movimientos','documentos',
        'log_auditoria','repositorios','carpetas','archivos_repositorio']);
    select coalesce(jsonb_agg(jsonb_build_object('bucket',f.bucket,'path',f.path,
        'updated_at',o.updated_at,'metadata',o.metadata) order by f.bucket,f.path),'[]'::jsonb)
    into v_archivos from (
        select 'repositorios'::text bucket, storage_path path from archivos_repositorio
        union select 'documentos', archivo_path from documentos where archivo_path is not null
    ) f left join storage.objects o on o.bucket_id=f.bucket and o.name=f.path;
    return jsonb_build_object('tablas',v_tablas,'esquema',v_esquema,'archivos',v_archivos,
        'revision',md5(v_tablas::text || v_esquema::text || v_archivos::text));
end;
$$;

create or replace function public.sgde_backup_restore(p_job uuid, p_tablas jsonb,
    p_esquema jsonb, p_archivos jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_job public.sgde_backup_jobs%rowtype;
    v_actual jsonb;
    v_tabla text;
    v_trigger record;
    v_triggers jsonb;
    v_carpeta jsonb;
    v_pendientes jsonb;
    v_restantes jsonb;
    v_progreso boolean;
    v_total integer := 0;
    v_esperadas text[] := array['usuarios','productos','recepciones','recepcion_detalle',
        'kardex_movimientos','documentos','log_auditoria','repositorios','carpetas','archivos_repositorio'];
begin
    select * into strict v_job from sgde_backup_jobs where id=p_job for update;
    if v_job.estado <> 'preparando' or v_job.expires_at <= now() then
        raise exception 'La restauración venció o ya fue completada';
    end if;
    lock table usuarios, productos, recepciones, recepcion_detalle, kardex_movimientos,
        documentos, log_auditoria, repositorios, carpetas, archivos_repositorio in access exclusive mode;
    v_actual := sgde_backup_snapshot();
    if v_actual->>'revision' <> v_job.revision then
        raise exception 'La información cambió mientras se preparaba la restauración. Reinicia sin otros usuarios trabajando';
    end if;
    if p_esquema is distinct from v_actual->'esquema' then
        raise exception 'La copia pertenece a una versión distinta de la base de datos';
    end if;
    if jsonb_typeof(p_tablas) is distinct from 'object' or
       (select count(*) from jsonb_object_keys(p_tablas)) <> cardinality(v_esperadas) then
        raise exception 'La copia no contiene las diez tablas requeridas';
    end if;
    foreach v_tabla in array v_esperadas loop
        if jsonb_typeof(p_tablas->v_tabla) is distinct from 'array' then
            raise exception 'Tabla ausente o inválida: %',v_tabla;
        end if;
        v_total := v_total + jsonb_array_length(p_tablas->v_tabla);
    end loop;
    if not exists(
        select 1 from jsonb_array_elements(p_tablas->'usuarios') u
        join public.usuarios actor on actor.username = v_job.actor
        where u->>'rol' = 'admin' and u->>'activo' = 'true'
          and u->>'auth_user_id' = actor.auth_user_id::text
          and actor.activo and actor.rol = 'admin'
    ) then
        raise exception 'La copia debe conservar como administrador activo a la cuenta que restaura';
    end if;
    -- Cada archivo debe haber sido recibido y verificado por el servidor.
    if jsonb_typeof(p_archivos) is distinct from 'array' then raise exception 'Lista de archivos inválida'; end if;
    if exists(select 1 from jsonb_array_elements(p_archivos) a where not exists(
        select 1 from sgde_backup_files f where f.job_id=p_job and f.bucket=a->>'bucket'
        and f.path=a->>'path' and f.sha256=a->>'sha256' and f.bytes=(a->>'bytes')::bigint
        and f.object_revision=sgde_backup_object_revision(f.bucket,f.path))) then
        raise exception 'Hay archivos sin verificar en el servidor';
    end if;
    if exists(select 1 from (
        select 'repositorios' bucket, a->>'storage_path' path from jsonb_array_elements(p_tablas->'archivos_repositorio') a
        union all select 'documentos', d->>'archivo_path' from jsonb_array_elements(p_tablas->'documentos') d
            where d->>'archivo_path' is not null
    ) refs where not exists(select 1 from jsonb_array_elements(p_archivos) a
        where a->>'bucket'=refs.bucket and a->>'path'=refs.path)) then
        raise exception 'Un registro apunta a un archivo que no fue restaurado';
    end if;
    -- Guardar el estado de los triggers y suspender solo los de negocio.
    -- Las claves foráneas y restricciones de PostgreSQL siguen activas.
    select coalesce(jsonb_agg(jsonb_build_object('tabla',c.relname,'nombre',t.tgname,
        'estado',t.tgenabled)),'[]'::jsonb) into v_triggers
    from pg_trigger t join pg_class c on c.oid=t.tgrelid
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname=any(v_esperadas) and not t.tgisinternal;
    foreach v_tabla in array v_esperadas loop
        execute format('alter table public.%I disable trigger user',v_tabla);
    end loop;
    -- TRUNCATE e inserciones forman una sola transacción: un error revierte todo.
    truncate table recepcion_detalle, kardex_movimientos, recepciones, productos,
        archivos_repositorio, carpetas, repositorios, documentos, log_auditoria, usuarios;
    foreach v_tabla in array array['usuarios','productos','recepciones','recepcion_detalle',
        'repositorios','documentos','kardex_movimientos','log_auditoria'] loop
        execute format('insert into public.%I select * from jsonb_populate_recordset(null::public.%I,$1)',v_tabla,v_tabla)
            using p_tablas->v_tabla;
    end loop;
    -- Las carpetas se insertan de padres a hijos, sin desactivar sus relaciones.
    v_pendientes := p_tablas->'carpetas';
    while jsonb_array_length(v_pendientes)>0 loop
        v_restantes := '[]'::jsonb; v_progreso := false;
        for v_carpeta in select value from jsonb_array_elements(v_pendientes) loop
            if v_carpeta->>'carpeta_padre_id' is null or exists(
                select 1 from carpetas where id=(v_carpeta->>'carpeta_padre_id')::uuid) then
                insert into carpetas select * from jsonb_populate_record(null::carpetas,v_carpeta);
                v_progreso := true;
            else v_restantes := v_restantes || jsonb_build_array(v_carpeta);
            end if;
        end loop;
        if not v_progreso then raise exception 'La jerarquía de carpetas no es válida'; end if;
        v_pendientes := v_restantes;
    end loop;
    insert into archivos_repositorio select * from jsonb_populate_recordset(null::archivos_repositorio,p_tablas->'archivos_repositorio');
    if exists(select 1 from carpetas c join carpetas padre on padre.id=c.carpeta_padre_id
        where c.repositorio_id<>padre.repositorio_id) or exists(
        select 1 from archivos_repositorio a join carpetas c on c.id=a.carpeta_id
        where a.repositorio_id<>c.repositorio_id) then
        raise exception 'Hay carpetas o archivos vinculados a otro repositorio';
    end if;
    if exists(select 1 from kardex_movimientos k where
        coalesce(k.ingreso,0)<0 or coalesce(k.salida,0)<0 or
        coalesce(k.ingreso,0)::text in ('NaN','Infinity','-Infinity') or
        coalesce(k.salida,0)::text in ('NaN','Infinity','-Infinity') or
        (coalesce(k.ingreso,0)>0 and coalesce(k.salida,0)>0) or
        (k.recepcion_id is not null and not exists(select 1 from recepcion_detalle d
            where d.recepcion_id=k.recepcion_id and d.producto_id=k.producto_id))) then
        raise exception 'La copia contiene movimientos inválidos o ajenos a su acta';
    end if;
    -- No se inventan saldos ni se ejecutan triggers que alteren las versiones.
    if exists(select 1 from productos p where coalesce(p.stock,0) is distinct from
        (select coalesce(sum(coalesce(k.ingreso,0)-coalesce(k.salida,0)),0) from kardex_movimientos k where k.producto_id=p.id)) then
        raise exception 'La copia tiene diferencias entre stock y movimientos de Kardex';
    end if;
    if exists(select 1 from (select saldo,sum(coalesce(ingreso,0)-coalesce(salida,0)) over
        (partition by recepcion_id,producto_id order by created_at,id rows unbounded preceding) esperado
        from kardex_movimientos) k where k.saldo is distinct from k.esperado) then
        raise exception 'La copia contiene saldos de Kardex inconsistentes';
    end if;
    for v_trigger in select * from jsonb_to_recordset(v_triggers) as x(tabla text,nombre text,estado text) loop
        execute format('alter table public.%I %s trigger %I',v_trigger.tabla,
            case v_trigger.estado when 'D' then 'disable' when 'R' then 'enable replica'
            when 'A' then 'enable always' else 'enable' end,v_trigger.nombre);
    end loop;
    insert into log_auditoria(usuario,accion,tabla,registro_id,detalle)
    values(v_job.actor,'RESTORE','sistema',p_job::text,
        format('Restauración completa: %s registros y %s archivos. Las credenciales son las de la copia.',
            v_total,jsonb_array_length(p_archivos)));
    update sgde_backup_jobs set estado='completado' where id=p_job;
    return jsonb_build_object('registros',v_total,'archivos',jsonb_array_length(p_archivos));
end;
$$;
revoke all on function public.sgde_backup_snapshot() from public, anon, authenticated;
revoke all on function public.sgde_backup_restore(uuid,jsonb,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.sgde_backup_snapshot() to service_role;
grant execute on function public.sgde_backup_restore(uuid,jsonb,jsonb,jsonb) to service_role;
