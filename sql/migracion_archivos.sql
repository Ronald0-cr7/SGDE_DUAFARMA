-- ============================================================
-- MIGRACIÓN: agrega soporte de archivos (subida/descarga real)
-- a un proyecto que YA ejecutó schema.sql anteriormente.
-- Pega esto en el SQL Editor de Supabase y ejecútalo UNA vez.
-- ============================================================

alter table documentos add column if not exists archivo_path text;
alter table documentos add column if not exists archivo_nombre text;
