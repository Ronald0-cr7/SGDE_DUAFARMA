-- ============================================================
-- MIGRACIÓN: agrega soporte de archivos (subida/descarga real)
-- a un proyecto que YA ejecutó schema.sql anteriormente.
-- Pega esto en el SQL Editor de Supabase y ejecútalo UNA vez.
-- ============================================================

alter table documentos add column if not exists archivo_path text;
alter table documentos add column if not exists archivo_nombre text;

-- Por si acaso RLS estuviera bloqueando las tablas (ver conversación previa)
alter table usuarios disable row level security;
alter table productos disable row level security;
alter table recepciones disable row level security;
alter table recepcion_detalle disable row level security;
alter table kardex_movimientos disable row level security;
alter table documentos disable row level security;
alter table log_auditoria disable row level security;
