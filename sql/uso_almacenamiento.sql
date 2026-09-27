-- Medidor de capacidad para el panel principal del SGDE.
-- Ejecutar una sola vez en Supabase Dashboard > SQL Editor.
-- Solo devuelve totales agregados; no expone nombres ni contenido de archivos.

create or replace function public.obtener_uso_almacenamiento()
returns table (
    database_bytes bigint,
    storage_bytes bigint,
    storage_files bigint
)
language sql
security definer
set search_path = ''
stable
as $$
    select
        pg_database_size(current_database())::bigint,
        coalesce(sum(
            case
                when o.metadata->>'size' ~ '^[0-9]+$'
                then (o.metadata->>'size')::bigint
                else 0
            end
        ), 0)::bigint,
        count(o.id)::bigint
    from storage.objects as o;
$$;

revoke all on function public.obtener_uso_almacenamiento() from public;
grant execute on function public.obtener_uso_almacenamiento() to anon, authenticated;

comment on function public.obtener_uso_almacenamiento() is
'Devuelve únicamente el tamaño total de PostgreSQL y Storage para el medidor del SGDE.';
