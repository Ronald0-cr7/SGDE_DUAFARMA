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

alter table repositorios enable row level security;
alter table carpetas enable row level security;
alter table archivos_repositorio enable row level security;

-- ============================================================
-- Las políticas de acceso se aplican en migracion_seguridad_auth.sql.
-- ============================================================
insert into storage.buckets (id, name, public)
values ('repositorios', 'repositorios', false)
on conflict (id) do update set public = false;

-- ============================================================
-- Datos de ejemplo (opcional, puedes borrarlos luego)
-- ============================================================
insert into repositorios (nombre, descripcion, creado_por) values
('Procedimientos Operativos', 'POEs y formatos de almacenamiento', 'admin'),
('Documentos de Proveedores', 'Fichas técnicas y certificados', 'admin');
