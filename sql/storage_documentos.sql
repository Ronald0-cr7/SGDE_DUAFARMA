-- ============================================================
-- STORAGE: bucket "documentos" + políticas de acceso
-- Ejecuta esto en el SQL Editor de Supabase DESPUÉS de crear
-- el bucket desde la pantalla de Storage (paso manual, ver LEEME.md).
--
-- Por qué falla aunque el bucket exista: Supabase Storage tiene su
-- propia tabla interna storage.objects con RLS activado por defecto.
-- Aunque marques el bucket como "Public", eso SOLO habilita la
-- LECTURA pública; para subir (INSERT), reemplazar (UPDATE) o
-- borrar (DELETE) archivos siempre hacen falta políticas explícitas.
-- Como este proyecto no usa Supabase Auth (login propio con la
-- tabla "usuarios"), todas las peticiones llegan como rol "anon",
-- así que las políticas deben permitir explícitamente ese rol.
-- ============================================================

-- 1) Crear el bucket por SQL (evita el paso manual si prefieres)
insert into storage.buckets (id, name, public)
values ('documentos', 'documentos', true)
on conflict (id) do update set public = true;

-- 2) Políticas sobre storage.objects, limitadas al bucket "documentos"
drop policy if exists "documentos_select_publico" on storage.objects;
create policy "documentos_select_publico"
on storage.objects for select
to anon, authenticated
using ( bucket_id = 'documentos' );

drop policy if exists "documentos_insert_publico" on storage.objects;
create policy "documentos_insert_publico"
on storage.objects for insert
to anon, authenticated
with check ( bucket_id = 'documentos' );

drop policy if exists "documentos_update_publico" on storage.objects;
create policy "documentos_update_publico"
on storage.objects for update
to anon, authenticated
using ( bucket_id = 'documentos' )
with check ( bucket_id = 'documentos' );

drop policy if exists "documentos_delete_publico" on storage.objects;
create policy "documentos_delete_publico"
on storage.objects for delete
to anon, authenticated
using ( bucket_id = 'documentos' );

-- Nota de seguridad (para tu tesis): estas políticas dejan el bucket
-- abierto a cualquiera con la anon key, igual que las tablas sin RLS
-- del resto del prototipo. Es válido para una demo académica; en un
-- entorno productivo real se restringiría "to authenticated" usando
-- Supabase Auth de verdad, en vez de "anon".
