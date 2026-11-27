-- Las políticas de acceso se aplican en migracion_seguridad_auth.sql.
insert into storage.buckets (id, name, public)
values ('documentos', 'documentos', false)
on conflict (id) do update set public = false;
