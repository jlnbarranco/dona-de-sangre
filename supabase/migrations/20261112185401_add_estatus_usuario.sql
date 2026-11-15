-- SPEC 08: estatus de usuario (activo / inactivo) y bloqueo de cuentas inactivas.

create type public.estatus_usuario as enum ('activo', 'inactivo');

alter table public.usuarios
  add column estatus public.estatus_usuario not null default 'activo';

-- Sincroniza el estatus con el baneo de Supabase Auth.
-- security definer porque el rol 'authenticated' no puede escribir en auth.users.
create or replace function private.sync_user_estatus()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update auth.users
  set banned_until = case
    when new.estatus = 'inactivo' then now() + interval '100 years'
    else null
  end
  where id = new.id;

  return new;
end;
$$;

drop trigger if exists on_usuarios_estatus_changed on public.usuarios;
create trigger on_usuarios_estatus_changed
after update of estatus on public.usuarios
for each row
when (old.estatus is distinct from new.estatus)
execute function private.sync_user_estatus();
