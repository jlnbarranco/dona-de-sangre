-- SPEC 02: perfiles de usuario, roles y RLS.
-- Versiones aplicadas: 20261107235333 (base) + 20261107235752 (RLS y triggers).

create schema if not exists private;

create type public.rol_usuario as enum ('admin', 'supervisor', 'capturador');

create table public.usuarios (
  id uuid primary key references auth.users (id) on delete cascade,
  nombre text not null check (length(btrim(nombre)) between 1 and 120),
  email text not null unique,
  rol public.rol_usuario not null default 'capturador',
  created_at timestamptz not null default now()
);

alter table public.usuarios enable row level security;

revoke all on public.usuarios from anon, authenticated;
grant select on public.usuarios to authenticated;

-- Helper security definer para evitar la recursión de RLS al leer el propio rol.
create or replace function private.current_user_rol()
returns public.rol_usuario
language sql
stable
security definer
set search_path = ''
as $$
  select rol from public.usuarios where id = auth.uid();
$$;

grant usage on schema private to authenticated;
grant execute on function private.current_user_rol() to authenticated;

create policy usuarios_select_own
on public.usuarios
for select
to authenticated
using (id = (select auth.uid()));

create policy usuarios_select_staff
on public.usuarios
for select
to authenticated
using (private.current_user_rol() in ('admin', 'supervisor'));

-- Alta de perfil: el nombre sale del metadato 'nombre' o de la parte local del correo.
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  nombre_meta text;
begin
  if new.email is null then
    return new;
  end if;

  nombre_meta := nullif(btrim(new.raw_user_meta_data ->> 'nombre'), '');

  insert into public.usuarios (id, nombre, email)
  values (
    new.id,
    coalesce(nombre_meta, split_part(new.email, '@', 1)),
    lower(new.email)
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

-- Sincronización del correo cuando cambia en auth.users.
create or replace function private.sync_user_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is null then
    return new;
  end if;

  update public.usuarios
  set email = lower(new.email)
  where id = new.id;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function private.handle_new_user();

drop trigger if exists on_auth_user_email_updated on auth.users;
create trigger on_auth_user_email_updated
after update of email on auth.users
for each row execute function private.sync_user_email();
