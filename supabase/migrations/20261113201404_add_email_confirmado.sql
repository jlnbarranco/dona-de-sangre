-- SPEC 10: estado de la invitación (correo confirmado y fecha del último envío).

alter table public.usuarios
  add column email_confirmado boolean not null default false,
  add column invitado_at timestamptz;

-- Sincroniza el estado de la invitación con auth.users.
-- security definer porque el rol 'authenticated' no puede escribir en auth.users.
create or replace function private.sync_user_invitation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.usuarios
  set email_confirmado = new.email_confirmed_at is not null,
      invitado_at = new.invited_at
  where id = new.id;

  return new;
end;
$$;

-- Solo se actualiza el perfil cuando cambia el dato de origen.
drop trigger if exists on_auth_user_invitation_changed on auth.users;
create trigger on_auth_user_invitation_changed
after update of email_confirmed_at, invited_at on auth.users
for each row
when (old.email_confirmed_at is distinct from new.email_confirmed_at
   or old.invited_at is distinct from new.invited_at)
execute function private.sync_user_invitation();

-- Backfill: el estado real de las cuentas que ya existen.
update public.usuarios u
set email_confirmado = (a.email_confirmed_at is not null),
    invitado_at = a.invited_at
from auth.users a
where a.id = u.id;
