begin;

-- Vincula las cuentas existentes antes de ejecutar este archivo (ver SEGURIDAD_SUPABASE.md).
alter table public.usuarios add column if not exists auth_user_id uuid unique
    references auth.users(id) on delete set null;

do $$
begin
    if exists (select 1 from public.usuarios where activo and auth_user_id is null) then
        raise exception 'Vincula primero todos los perfiles activos con Supabase Auth';
    end if;
    if not exists (select 1 from public.usuarios where activo and rol = 'admin' and auth_user_id is not null) then
        raise exception 'Debe existir al menos un administrador activo vinculado';
    end if;
end
$$;

alter table public.usuarios drop column if exists password;

create schema if not exists sgde_private;
revoke all on schema sgde_private from public, anon;
grant usage on schema sgde_private to authenticated;

create or replace function sgde_private.rol_actual()
returns text
language sql stable security definer
set search_path = ''
as $$
    select u.rol from public.usuarios u where u.auth_user_id = auth.uid() and u.activo;
$$;

revoke all on function sgde_private.rol_actual() from public, anon;
grant execute on function sgde_private.rol_actual() to authenticated;

do $$
declare
    tabla text;
    antigua record;
begin
    foreach tabla in array array['usuarios','productos','recepciones','recepcion_detalle',
        'kardex_movimientos','documentos','log_auditoria','repositorios','carpetas','archivos_repositorio']
    loop
        execute format('alter table public.%I enable row level security', tabla);
        execute format('revoke all on public.%I from public, anon, authenticated', tabla);
        execute format('grant select on public.%I to authenticated', tabla);
        execute format('grant all on public.%I to service_role', tabla);
        for antigua in select policyname from pg_policies
            where schemaname = 'public' and tablename = tabla
        loop
            execute format('drop policy %I on public.%I', antigua.policyname, tabla);
        end loop;
    end loop;
end
$$;

create policy sgde_usuarios_leer on public.usuarios for select to authenticated
using ((auth_user_id = (select auth.uid()) and activo) or (select sgde_private.rol_actual()) = 'admin');

-- La creación y el cambio de contraseña pasan por la función de administración.
grant update (username, nombre, rol, activo) on public.usuarios to authenticated;
create policy sgde_usuarios_editar on public.usuarios for update to authenticated
using ((select sgde_private.rol_actual()) = 'admin')
with check ((select sgde_private.rol_actual()) = 'admin'
    and (not activo or auth_user_id is not null)
    and (auth_user_id is distinct from (select auth.uid()) or (activo and rol = 'admin')));

do $$
declare
    tabla text;
    permiso text;
begin
    foreach tabla in array array['productos','recepciones','recepcion_detalle','kardex_movimientos',
        'documentos','repositorios','carpetas','archivos_repositorio']
    loop
        -- La vista Kardex también utiliza recepciones para identificar el acta.
        permiso := case when tabla = 'recepcion_detalle'
            then '(select sgde_private.rol_actual()) in (''admin'', ''asistente'')'
            else '(select sgde_private.rol_actual()) is not null' end;
        execute format('create policy sgde_leer on public.%I for select to authenticated using (%s)', tabla, permiso);

        permiso := case when tabla in ('repositorios','carpetas','archivos_repositorio')
            then '(select sgde_private.rol_actual()) = ''admin'''
            else '(select sgde_private.rol_actual()) in (''admin'', ''asistente'')' end;
        execute format('grant insert, update, delete on public.%I to authenticated', tabla);
        execute format('create policy sgde_insertar on public.%I for insert to authenticated with check (%s)',
            tabla, case when tabla = 'documentos' then '(select sgde_private.rol_actual()) = ''admin''' else permiso end);
        execute format('create policy sgde_editar on public.%I for update to authenticated using (%s) with check (%s)',
            tabla, permiso, permiso);
        execute format('create policy sgde_borrar on public.%I for delete to authenticated using (%s)', tabla, permiso);
    end loop;
end
$$;

grant insert on public.log_auditoria to authenticated;
create policy sgde_auditoria_leer on public.log_auditoria for select to authenticated
using ((select sgde_private.rol_actual()) = 'admin' or usuario =
    (select u.username from public.usuarios u where u.auth_user_id = (select auth.uid()) and u.activo));
create policy sgde_auditoria_insertar on public.log_auditoria for insert to authenticated
with check ((select sgde_private.rol_actual()) is not null and usuario =
    (select u.username from public.usuarios u where u.auth_user_id = (select auth.uid()) and u.activo));

do $$
declare
    rutina record;
begin
    if to_regclass('public.kardex_por_acta') is not null then
        alter view public.kardex_por_acta set (security_invoker = true);
        revoke all on public.kardex_por_acta from public, anon, authenticated;
        grant select on public.kardex_por_acta to authenticated;
    end if;

    for rutina in
        select p.oid::regprocedure as firma, p.proname
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname in (
            'registrar_recepcion_completa','actualizar_acta_completa','eliminar_acta_completa',
            'consultar_lotes_kardex','registrar_salida_kardex','asignar_salida_acta','eliminar_kardex_acta',
            'fn_recalcular_kardex_producto','fn_sincronizar_catalogo_acta','obtener_uso_almacenamiento',
            'sgde_backup_snapshot','sgde_backup_restore','sgde_backup_object_revision')
    loop
        execute format('revoke execute on function %s from public, anon', rutina.firma);
        if rutina.proname like 'sgde_backup_%' then
            execute format('revoke execute on function %s from authenticated', rutina.firma);
        else
            execute format('grant execute on function %s to authenticated', rutina.firma);
        end if;
    end loop;
end
$$;

-- Las políticas restrictivas también se aplican si quedó alguna política permisiva anterior.
update storage.buckets set public = false where id in ('documentos','repositorios');

drop policy if exists sgde_archivos_limite on storage.objects;
create policy sgde_archivos_limite on storage.objects as restrictive for all to anon
using (bucket_id not in ('documentos','repositorios'))
with check (bucket_id not in ('documentos','repositorios'));

drop policy if exists sgde_archivos_leer_limite on storage.objects;
create policy sgde_archivos_leer_limite on storage.objects as restrictive for select to authenticated
using (bucket_id not in ('documentos','repositorios') or (select sgde_private.rol_actual()) is not null);

drop policy if exists sgde_archivos_crear_limite on storage.objects;
create policy sgde_archivos_crear_limite on storage.objects as restrictive for insert to authenticated
with check (bucket_id not in ('documentos','repositorios') or (select sgde_private.rol_actual()) = 'admin'
    or (bucket_id = 'documentos' and (select sgde_private.rol_actual()) = 'asistente'));

drop policy if exists sgde_archivos_editar_limite on storage.objects;
create policy sgde_archivos_editar_limite on storage.objects as restrictive for update to authenticated
using (bucket_id not in ('documentos','repositorios') or (select sgde_private.rol_actual()) = 'admin')
with check (bucket_id not in ('documentos','repositorios') or (select sgde_private.rol_actual()) = 'admin');

drop policy if exists sgde_archivos_borrar_limite on storage.objects;
create policy sgde_archivos_borrar_limite on storage.objects as restrictive for delete to authenticated
using (bucket_id not in ('documentos','repositorios') or (select sgde_private.rol_actual()) = 'admin'
    or (bucket_id = 'documentos' and (select sgde_private.rol_actual()) = 'asistente'));

do $$
declare
    politica text;
begin
    foreach politica in array array[
        'repositorios_select_publico','repositorios_insert_publico','repositorios_update_publico','repositorios_delete_publico',
        'documentos_select_publico','documentos_insert_publico','documentos_update_publico','documentos_delete_publico',
        'sgde_archivos_operar'
    ] loop
        execute format('drop policy if exists %I on storage.objects', politica);
    end loop;
end
$$;

create policy sgde_archivos_operar on storage.objects for all to authenticated
using (bucket_id in ('documentos','repositorios'))
with check (bucket_id in ('documentos','repositorios'));

commit;
