-- ============================================================
-- MÓDULO: Repositorios Digitales (estilo Google Drive)
-- Ejecuta este script completo en el SQL Editor de Supabase.
-- ============================================================

-- ---------- REPOSITORIOS (carpeta raíz de más alto nivel) ----------
create table repositorios (
    id uuid primary key default gen_random_uuid(),
    nombre text not null,
    descripcion text,
    creado_por text not null,
    created_at timestamptz default now()
);

-- ---------- CARPETAS (y subcarpetas, autorreferenciada) ----------
create table carpetas (
    id uuid primary key default gen_random_uuid(),
    repositorio_id uuid not null references repositorios(id) on delete cascade,
    carpeta_padre_id uuid references carpetas(id) on delete cascade,  -- null = está en la raíz del repositorio
    nombre text not null,
    creado_por text not null,
    created_at timestamptz default now()
);

-- ---------- ARCHIVOS ----------
create table archivos_repositorio (
    id uuid primary key default gen_random_uuid(),
    repositorio_id uuid not null references repositorios(id) on delete cascade,
    carpeta_id uuid references carpetas(id) on delete cascade,  -- null = está en la raíz del repositorio
    nombre text not null,              -- nombre visible (editable con "Renombrar")
    nombre_original text not null,     -- nombre del archivo tal como se subió
    extension text,
    tipo_mime text,
    tamanio_bytes bigint,
    storage_path text not null,        -- ruta real dentro del bucket "repositorios"
    subido_por text not null,
    created_at timestamptz default now()
);

create index idx_carpetas_padre on carpetas(carpeta_padre_id);
create index idx_carpetas_repo on carpetas(repositorio_id);
create index idx_archivos_carpeta on archivos_repositorio(carpeta_id);
create index idx_archivos_repo on archivos_repositorio(repositorio_id);
create index idx_archivos_nombre on archivos_repositorio using gin (to_tsvector('spanish', nombre));

-- Sin RLS, para consistencia con el resto del prototipo (ver notas de
-- seguridad en LEEME.md: el sistema usa login propio, no Supabase Auth)
alter table repositorios disable row level security;
alter table carpetas disable row level security;
alter table archivos_repositorio disable row level security;

-- ============================================================
-- STORAGE: bucket "repositorios" + políticas (igual patrón que
-- storage_documentos.sql, ver esos comentarios para el detalle)
-- ============================================================
insert into storage.buckets (id, name, public)
values ('repositorios', 'repositorios', true)
on conflict (id) do update set public = true;

drop policy if exists "repositorios_select_publico" on storage.objects;
create policy "repositorios_select_publico"
on storage.objects for select
to anon, authenticated
using ( bucket_id = 'repositorios' );

drop policy if exists "repositorios_insert_publico" on storage.objects;
create policy "repositorios_insert_publico"
on storage.objects for insert
to anon, authenticated
with check ( bucket_id = 'repositorios' );

drop policy if exists "repositorios_update_publico" on storage.objects;
create policy "repositorios_update_publico"
on storage.objects for update
to anon, authenticated
using ( bucket_id = 'repositorios' )
with check ( bucket_id = 'repositorios' );

drop policy if exists "repositorios_delete_publico" on storage.objects;
create policy "repositorios_delete_publico"
on storage.objects for delete
to anon, authenticated
using ( bucket_id = 'repositorios' );

-- ============================================================
-- Datos de ejemplo (opcional, puedes borrarlos luego)
-- ============================================================
insert into repositorios (nombre, descripcion, creado_por) values
('Procedimientos Operativos', 'POEs y formatos de almacenamiento', 'admin'),
('Documentos de Proveedores', 'Fichas técnicas y certificados', 'admin');
