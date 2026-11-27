begin;

-- Las escrituras del panel pasan por sgde-usuarios.
revoke update (username, nombre, rol, activo) on public.usuarios from authenticated;
drop policy if exists sgde_usuarios_editar on public.usuarios;

create or replace function sgde_private.proteger_administrador_auth()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
    if new.auth_user_id is null then
        new.activo := false;
    end if;
    if old.activo and old.rol = 'admin' and old.auth_user_id is not null
       and (not new.activo or new.rol <> 'admin' or new.auth_user_id is distinct from old.auth_user_id) then
        perform pg_catalog.pg_advisory_xact_lock(736401, 1);
        if not exists (
            select 1 from public.usuarios
            where id <> old.id and activo and rol = 'admin' and auth_user_id is not null
        ) then
            raise exception 'Debe quedar un administrador activo vinculado' using errcode = '23514';
        end if;
    end if;
    return new;
end;
$$;

revoke all on function sgde_private.proteger_administrador_auth() from public, anon, authenticated;
drop trigger if exists proteger_administrador_auth on public.usuarios;
create trigger proteger_administrador_auth
before update of auth_user_id, rol, activo on public.usuarios
for each row execute function sgde_private.proteger_administrador_auth();

commit;
