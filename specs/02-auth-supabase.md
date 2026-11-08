# SPEC 02 — Autenticación con Supabase, SSR y tabla `usuarios`

> **Estado:** Aprobado
> **Depende de:** SPEC 01
> **Fecha:** 2026-11-07
> **Objetivo:** Conectar el login existente con Supabase Auth en modo SSR con cookies y crear la tabla `usuarios` con roles, un dashboard mínimo protegido y cierre de sesión.

## Por qué existe este spec

SPEC 01 dejó la pantalla de login sin autenticación real. El sitio es estático y las variables `SUPABASE_URL` / `SUPABASE_KEY` no tienen prefijo `PUBLIC_`, así que el navegador no puede leerlas.

Validar la sesión en el servidor exige cambiar el modelo de render: SSR con cookies, adapter de Netlify y un cliente Supabase por request. Este spec asienta esa base y el modelo de datos de usuarios; el flujo de invitación y contraseña propia se construye encima en SPEC 03.

## Alcance

**Incluido:**

- Adapter `@astrojs/netlify` con `output: 'server'` y `netlify.toml`.
- Paquete `@supabase/ssr` y cliente Supabase de servidor en `src/lib/supabase.ts`.
- Variables de entorno tipadas con `astro:env` (`context: 'server'`, `access: 'secret'`).
- Tipos de `App.Locals` en `src/env.d.ts`.
- Middleware en `src/middleware.ts` que refresca la sesión en cada request y protege `/dashboard`.
- Endpoint `POST /api/auth/login` con `signInWithPassword` y error genérico.
- Endpoint `POST /api/auth/logout` con `signOut`.
- Formulario de `src/pages/auth/login.astro` conectado al endpoint, con mensaje de error y estado de carga.
- Página protegida `src/pages/dashboard.astro` que muestra `nombre` y `rol` del usuario.
- Migración en Supabase: enum `public.rol_usuario`, tabla `public.usuarios`, triggers de sincronización y políticas RLS.
- Archivo de migración versionado en `supabase/migrations/`.
- Tipos TypeScript de la base generados en `src/lib/database.types.ts`.
- Documentación de la promoción manual de roles.

**Fuera de alcance (para specs futuros):**

- Invitación por correo, confirmación de email y pantalla de contraseña propia (SPEC 03).
- Registro público `/auth/register`.
- Panel administrativo de usuarios y asignación de roles desde UI.
- Recuperación de contraseña («¿Olvidaste tu contraseña?»).
- Envío de correos y configuración de SMTP.
- Auditar o corregir `public.rls_auto_enable()`, que ya existía en el proyecto.
- Tests automatizados: el proyecto no tiene runner.

## Modelo de datos

### Tabla `public.usuarios`

`usuarios` es el perfil público del usuario, **no** sus credenciales. La contraseña vive solo en `auth.users`, hasheada por Supabase. No existe columna `contraseña` ni `password_hash`.

| Columna      | Tipo                 | Restricciones                                              |
| ------------ | -------------------- | ---------------------------------------------------------- |
| `id`         | `uuid`               | PK, `references auth.users (id) on delete cascade`         |
| `nombre`     | `text`               | `not null`, `check (length(btrim(nombre)) between 1 and 120)` |
| `email`      | `text`               | `not null`, `unique`, normalizado a minúsculas por el trigger |
| `rol`        | `public.rol_usuario` | `not null`, `default 'capturador'`                         |
| `created_at` | `timestamptz`        | `not null`, `default now()`                                |

### Enum `public.rol_usuario`

```sql
create type public.rol_usuario as enum ('admin', 'supervisor', 'capturador');
```

### Estructura de la migración

```sql
create type public.rol_usuario as enum ('admin', 'supervisor', 'capturador');

create table public.usuarios (
  id uuid primary key references auth.users (id) on delete cascade,
  nombre text not null check (length(btrim(nombre)) between 1 and 120),
  email text not null unique,
  rol public.rol_usuario not null default 'capturador',
  created_at timestamptz not null default now()
);
```

Convenciones:

- El `id` es el mismo `auth.users.id`; no hay columna `auth_id` separada.
- `email` se guarda en minúsculas para poder comparar sin ambigüedad.
- La tabla no se expone para escritura al cliente: RLS y `grant` lo impiden.
- `rol` es un enum, no `text` con `check`: impide valores fuera del catálogo.

### Triggers sobre `auth.users`

- `private.handle_new_user()` en `after insert`: crea la fila en `usuarios` con `rol = 'capturador'`.
  - `nombre` sale de `new.raw_user_meta_data ->> 'nombre'`.
  - Si ese metadato falta o está vacío, usa `split_part(new.email, '@', 1)`.
  - Si `new.email` es nulo, no inserta y deja pasar el alta.
  - Usa `on conflict (id) do nothing` para ser idempotente.
- `private.sync_user_email()` en `after update of email`: copia `new.email` a `usuarios.email` para la misma fila.
- Ambas funciones son `security definer` con `set search_path = ''` y viven en el schema `private`.
- Los triggers se llaman `on_auth_user_created` y `on_auth_user_email_updated`.

### RLS

- `alter table public.usuarios enable row level security`.
- `revoke all on public.usuarios from anon, authenticated` y luego `grant select on public.usuarios to authenticated`.
- Política `usuarios_select_own`: un usuario autenticado lee su propia fila (`id = (select auth.uid())`).
- Política `usuarios_select_staff`: `admin` y `supervisor` leen todas las filas.
- Sin políticas de `insert`, `update` o `delete`: el cliente no escribe.
- Helper `private.current_user_rol()` (`security definer`, `stable`, `set search_path = ''`) devuelve el rol del usuario actual y evita la recursión de RLS.
- `grant usage on schema private to authenticated` y `grant execute on function private.current_user_rol() to authenticated`.

### Promoción manual de rol

```sql
update public.usuarios
set rol = 'admin'
where email = 'persona@dominio.com';
```

El primer `admin` se crea así, desde el SQL Editor o el MCP. No hay seed ni variable de entorno.

## Plan de implementación

1. Instalar `@astrojs/netlify` y `@supabase/ssr`; añadir el adapter y `output: 'server'` en `astro.config.mjs`; crear `netlify.toml` con `[build] command = "npm run build"`, `publish = "dist"` y `[build.environment] NODE_VERSION = "22"`. Verificar con `npm run build` que `/auth/login` y el redirect de `/` siguen funcionando.
2. Crear `src/lib/supabase.ts` con `createServerClient`, `parseCookieHeader` y `setAll`; declarar el schema de `astro:env`; crear `src/env.d.ts` con `App.Locals`; añadir `src/middleware.ts` que refresca la sesión, expone `locals.supabase` y `locals.claims`, protege `/dashboard` y saca a `/dashboard` a quien ya tiene sesión en `/auth/login`. Verificar en `npm run dev` que `/auth/login` responde 200 y `/dashboard` redirige a `/auth/login`.
3. Aplicar con el MCP la primera mitad de la migración: schema `private`, enum `public.rol_usuario`, tabla `public.usuarios`, `enable row level security` y los `grant`/`revoke`. Verificar por SQL que la tabla existe con RLS activo y que `anon` no tiene privilegios.
4. Aplicar con el MCP la segunda mitad: `private.current_user_rol()`, políticas `usuarios_select_own` y `usuarios_select_staff`, función y trigger de alta, función y trigger de email. Guardar el SQL completo en `supabase/migrations/<version>_create_usuarios.sql` usando la versión que devuelva `apply_migration`. Verificar creando un usuario de prueba y comprobando que aparece en `usuarios` con `rol = 'capturador'`.
5. Generar los tipos con `generate_typescript_types` del MCP y guardarlos en `src/lib/database.types.ts`; tipar el cliente con `Database`. Verificar que `npm run build` sigue pasando.
6. Crear `src/pages/dashboard.astro` protegida: lee `locals.claims`, consulta la fila de `usuarios` con el cliente del servidor y muestra `nombre`, `email` y `rol` en una tarjeta. Añadir `POST /api/auth/logout` y el botón «Cerrar sesión». Verificar que sin sesión se redirige y que con sesión se ve el perfil.
7. Crear `POST /api/auth/login`: valida que el cuerpo tenga `email` y `password`, llama a `signInWithPassword` y redirige a `/dashboard`. En error, redirige a `/auth/login?error=invalid_credentials`. Conectar el formulario de `src/pages/auth/login.astro` a ese endpoint y mostrar el mensaje genérico. Verificar el flujo completo credenciales incorrectas / correctas.
8. Documentar en `.env.template` que `SUPABASE_URL` y `SUPABASE_KEY` son de servidor y que `SUPABASE_DB_PASSWORD` es solo para CLI/MCP; actualizar la descripción del proyecto en `AGENTS.md` (SSR, Netlify, Supabase activo). Verificar que no queda ninguna variable `PUBLIC_` de Supabase ni clave `service_role` en el repositorio.

## Criterios de aceptación

- [x] `npm run build` termina sin errores con el adapter de Netlify.
- [x] `astro.config.mjs` declara `adapter: netlify()` y `output: 'server'`.
- [x] Existe `netlify.toml` con `command = "npm run build"`, `publish = "dist"` y `NODE_VERSION = "22"`.
- [x] En `npm run dev`, `/` redirige a `/auth/login`.
- [x] `/dashboard` sin sesión responde 302 a `/auth/login?next=%2Fdashboard`.
- [x] `/auth/login` con sesión activa responde 302 a `/dashboard`.
- [x] `/api/auth/login` y `/api/auth/logout` solo aceptan `POST`; un `GET` responde 405.
- [x] Login con contraseña incorrecta redirige a `/auth/login?error=invalid_credentials`.
- [x] El mensaje de error mostrado es «Correo o contraseña incorrectos» y no revela si el correo existe.
- [x] Login con credenciales válidas redirige a `/dashboard` y responde con cookies `sb-*-auth-token`.
- [x] Las cookies de sesión son `httpOnly`, `secure` en producción y `sameSite=lax`.
- [x] `/dashboard` muestra el `nombre`, el `email` y el `rol` de la fila de `usuarios`.
- [x] «Cerrar sesión» borra las cookies y redirige a `/auth/login`; después, `/dashboard` vuelve a redirigir al login.
- [x] Un usuario autenticado solo ve su propia fila al consultar `usuarios`.
- [x] Un usuario con rol `admin` o `supervisor` ve todas las filas.
- [x] La clave anónima no puede hacer `insert`, `update` ni `delete` sobre `usuarios`.
- [x] Crear un usuario en el Dashboard de Supabase genera una fila en `usuarios` con `rol = 'capturador'`.
- [x] Si el usuario se crea sin metadato `nombre`, `usuarios.nombre` es la parte local del correo.
- [x] Cambiar el correo en Auth actualiza `usuarios.email`.
- [x] Borrar el usuario en Auth borra su fila en `usuarios` (cascade).
- [x] El SQL aplicado está versionado en `supabase/migrations/`.
- [x] `src/lib/database.types.ts` existe y el cliente está tipado con `Database`.
- [x] No existe ninguna variable `PUBLIC_SUPABASE_*` ni clave `service_role` en el repositorio.
- [x] El advisor de seguridad de Supabase no reporta hallazgos nuevos; el aviso previo de `public.rls_auto_enable()` sigue igual y no se toca.
- [x] Login y dashboard son usables a 320 px de ancho, sin scroll horizontal.
- [x] No hay errores en la consola del navegador en login, dashboard ni logout.

## Decisiones tomadas y descartadas

- **Sí:** SSR con cookies y `@supabase/ssr`. La sesión se valida en el servidor; el navegador nunca ve la clave anónima.
- **No:** cliente de navegador con `localStorage`. Obliga a prefijar variables con `PUBLIC_` y deja la decisión de acceso en manos del cliente.
- **Sí:** `getClaims()` en middleware y páginas. Verifica el JWT; `getSession()` no es confiable para autorizar.
- **No:** `getUser()` en cada request. `getClaims()` resuelve igual de bien y evita una llamada de red por request cuando la firma es asimétrica.
- **Sí:** `astro:env` con `context: 'server'` y `access: 'secret'`. Falla en build si falta una variable y no puede filtrarse al bundle del cliente.
- **Sí:** `@astrojs/netlify`. Es el hosting elegido; el adapter traduce rutas SSR y `redirects`.
- **Sí:** tabla `usuarios` como perfil, sin contraseña. Duplicar el hash crearía dos fuentes de verdad y un riesgo de seguridad.
- **Sí:** `id` = `auth.users.id` con `on delete cascade`. Evita huérfanos y una columna extra de unión.
- **Sí:** enum `rol_usuario`. Impide roles inventados a nivel de motor.
- **Sí:** trigger para crear el perfil. Así el alta desde el Dashboard cumple el default `capturador` sin código de aplicación.
- **Sí:** helper `private.current_user_rol()` para RLS. Sin él, una política sobre `usuarios` que consulte `usuarios` provoca recursión infinita.
- **Sí:** proteger solo rutas bajo `/dashboard`. Una lista de rutas públicas se rompería al añadir `/auth/confirm` en SPEC 03.
- **Sí:** error genérico y redirect con `?error=invalid_credentials`. Evita enumeración de usuarios y no mete datos sensibles en la URL.
- **Sí:** `POST /api/auth/logout`. Un `GET` permitiría cerrar sesión desde un enlace de terceros.
- **Sí:** tipos generados con el MCP. No hay CLI de Supabase y no queremos añadirla solo para esto.
- **No:** seed de admin desde variables de entorno. La promoción manual por SQL es explícita y no deja credenciales en el repositorio.
- **No:** panel de gestión de usuarios. Va en su propio spec.
- **No:** registro público. El admin invita; no hay alta abierta.
- **No:** tests automatizados. No existe runner y añadirlo excede este spec.

## Riesgos

| Riesgo                                                              | Mitigación                                                                                                   |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| La validación de `astro:env` rompe el build si faltan variables     | Documentar las variables en `.env.template` y en la configuración de entorno de Netlify.                     |
| Netlify no inyecta las variables en runtime                         | Declararlas en el panel de Netlify con alcance de build y de functions; verificar en el primer deploy.       |
| `redirects` de `/` se comporta distinto con SSR                     | Verificarlo en el paso 1, antes de añadir autenticación.                                                     |
| Las cookies no viajan en desarrollo por `secure`                    | Aplicar `secure` solo en producción; `@supabase/ssr` ya deriva esto del protocolo.                           |
| `getClaims()` hace petición de red si la firma es simétrica         | Aceptado; el proyecto usa las claves JWT por defecto. Migrar a claves asimétricas cuando haya tráfico real.  |
| El cambio de email en Auth choca con el `unique` de `usuarios.email` | La operación en Auth falla y se resuelve a mano. Es un caso poco frecuente y deja los datos consistentes.    |
| RLS bloquea al propio usuario por un error en la política           | Probar con la clave anónima y con tres usuarios de roles distintos antes de dar el spec por terminado.       |
| El trigger de alta falla y bloquea la creación del usuario           | El trigger tolera email nulo y usa `on conflict do nothing`; probar el alta con y sin metadato `nombre`.     |
| El advisor de seguridad marca el helper `security definer`           | Vive en el schema `private`, no expuesto, y solo `authenticated` tiene `execute`. Revisar el advisor al final. |

## Qué **no** entra en este spec

- Invitación por correo, confirmación de cuenta y pantalla de contraseña propia.
- Registro público y autogestión de cuenta.
- Panel administrativo de usuarios y cambio de roles desde UI.
- Recuperación de contraseña.
- SMTP propio y plantillas de correo.
- `public.rls_auto_enable()`, que ya existía y queda como está.

Cada uno de esos puntos, si llega, va en su propio spec.

## Verificación

> **Fecha:** 2026-11-07
> **Resultado:** 26/26 criterios verificados

| Criterio | Estado | Evidencia | Notas |
| --- | --- | --- | --- |
| `npm run build` sin errores con adapter de Netlify | ✅ | `npm run build` → `[build] Complete!` (Server built in 5.29s, `adapter: @astrojs/netlify`); solo 2 avisos `Invalid empty selector` de daisyUI | Avisos no bloqueantes |
| `adapter: netlify()` y `output: 'server'` | ✅ | `astro.config.mjs:9-10` | — |
| `netlify.toml` con `command`, `publish`, `NODE_VERSION = "22"` | ✅ | `netlify.toml:1-6` | — |
| `/` redirige a `/auth/login` en dev | ✅ | `GET http://localhost:4321/` → **301** `Location: http://localhost:4321/auth/login` | — |
| `/dashboard` sin sesión → 302 `/auth/login?next=%2Fdashboard` | ✅ | `GET /dashboard` sin cookie → **302** `Location: /auth/login?next=%2Fdashboard` | — |
| `/auth/login` con sesión → 302 `/dashboard` | ✅ | `GET /auth/login` con cookie `sb-swguryvbjzosovilywxf-auth-token` → **302** `Location: /dashboard` | — |
| `GET` en login/logout → 405 | ✅ | `GET /api/auth/login` → **405**; `GET /api/auth/logout` → **405**; `src/pages/api/auth/login.ts:26-27`, `logout.ts:8-9` | — |
| Contraseña incorrecta → `/auth/login?error=invalid_credentials` | ✅ | Playwright: submit con contraseña errónea → URL final `http://localhost:4321/auth/login?error=invalid_credentials` | — |
| Mensaje «Correo o contraseña incorrectos» sin enumerar usuarios | ✅ | Playwright: `[role=alert]` = «Correo o contraseña incorrectos» tanto con contraseña errónea como con correo inexistente (`no-existe-xyz@example.com`) | Respuesta idéntica en ambos casos |
| Login válido → `/dashboard` con cookies `sb-*-auth-token` | ✅ | Playwright login `capturador.spec02@example.com` → `/dashboard`; cookie `sb-swguryvbjzosovilywxf-auth-token` presente | — |
| Cookies `httpOnly`, `secure` en producción, `sameSite=lax` | ✅ | Playwright (dev): `httpOnly: true`, `sameSite: "Lax"`, `secure: false`. Bundle de producción `.netlify/build/virtual_astro_middleware.mjs:46-48` → `secure: true` (`src/lib/supabase.ts:18-24`) | `secure` no se probó en un deploy real, solo en el bundle compilado |
| `/dashboard` muestra `nombre`, `email` y `rol` | ✅ | Playwright: el HTML contiene «Capturador Spec 02», «capturador.spec02@example.com» y «Administrador»; `src/pages/dashboard.astro:11-15,54-70` | — |
| «Cerrar sesión» borra cookies, redirige y protege `/dashboard` | ✅ | Playwright: click en «Cerrar sesión» → `/auth/login`; cookies `auth-token` 1 → 0; después `GET /dashboard` → **302** `/auth/login?next=%2Fdashboard` | — |
| Usuario autenticado solo ve su fila | ✅ | SQL con `set local role authenticated` + claim `sub` del usuario `capturador`: `select` devuelve **1 fila** (la propia) | — |
| `admin`/`supervisor` ven todas las filas | ✅ | SQL con claims del usuario `admin` → **3 filas**; con claims del usuario `supervisor` → **3 filas** | 3 usuarios temporales durante la prueba |
| `anon` sin `insert`/`update`/`delete` | ✅ | SQL: `anon` insert/update/delete → `42501 permission denied for table usuarios`; `has_table_privilege('anon', ...)` = false; `authenticated` tampoco tiene DML (solo `SELECT`) | — |
| Alta en Auth crea fila con `rol = 'capturador'` | ✅ | SQL: `insert` en `auth.users` (equivalente al alta del Dashboard) → fila en `usuarios` con `rol = 'capturador'` | Trigger `on_auth_user_created` |
| Sin metadato `nombre` usa la parte local del correo | ✅ | SQL: alta con `raw_user_meta_data = {"foo":"bar"}` y email `temp.beta@example.com` → `usuarios.nombre = 'temp.beta'` | — |
| Cambio de email sincroniza `usuarios.email` | ✅ | SQL: `update auth.users set email='Temp.Beta2@Example.com'` → `usuarios.email = 'temp.beta2@example.com'` | Normaliza a minúsculas |
| Borrado en Auth hace cascade | ✅ | SQL: `delete from auth.users` → desaparece la fila de `usuarios`; el resto permanece | — |
| SQL versionado en `supabase/migrations/` | ✅ | `supabase/migrations/20261107235752_create_usuarios.sql`; `list_migrations` = `20261107235333` + `20261107235752` | Ambas mitades consolidadas en un archivo, con las dos versiones documentadas en la cabecera |
| `src/lib/database.types.ts` y cliente tipado con `Database` | ✅ | `src/lib/database.types.ts` (180 líneas); `src/lib/supabase.ts:10-11` usa `SupabaseClient<Database>` | — |
| Sin `PUBLIC_SUPABASE_*` ni clave `service_role` en el repo | ✅ | `grep` sin `PUBLIC_SUPABASE_*` ni JWT (`eyJhbGciOi`) en el repo; `.env.template:1-7` documenta variables de servidor. `service_role` solo aparece como texto en documentación/skills, no como clave | `.env` local no versionado |
| Advisor sin hallazgos nuevos; `rls_auto_enable()` intacto | ✅ | `get_advisors(security)`: solo los 2 avisos preexistentes de `public.rls_auto_enable()` (anon/authenticated) y `auth_leaked_password_protection` (opción de Auth preexistente y fuera de alcance) | No se modificó `rls_auto_enable()` |
| Login y dashboard usables a 320 px sin scroll horizontal | ✅ | Playwright a 320×720: login `scrollWidth = 320 = innerWidth`; dashboard `scrollWidth = 320 = innerWidth`; capturas `spec02-login-320.png` y `spec02-dashboard-320.png` | — |
| Sin errores de consola en login, dashboard ni logout | ✅ | Playwright con listeners `console`/`pageerror`: 0 errores en login inválido, login válido + dashboard y logout | — |
