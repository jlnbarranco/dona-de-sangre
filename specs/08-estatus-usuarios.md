# SPEC 08 — Estatus de usuario y bloqueo de cuentas inactivas

> **Estado:** Implementado
> **Depende de:** SPEC 02, SPEC 07
> **Fecha:** 2026-11-12
> **Objetivo:** Añadir el enum `estatus_usuario` a `public.usuarios` con los valores `activo` e `inactivo`, impedir que una cuenta inactiva inicie sesión o use la aplicación, y mostrar su estatus en el listado de `/dashboard/admin/users`.

## Por qué existe este spec

El listado de usuarios de SPEC 07 permite ver quién está registrado en el laboratorio, pero no dice quién puede seguir entrando. Hoy el único control de acceso es el rol: un `capturador` ve menos que un `admin`, pero todos los que tienen cuenta entran igual. Cuando alguien deja el laboratorio (renuncia, cambio de proyecto, contrato temporal) su cuenta sigue viva y su sesión sigue siendo válida.

Este spec introduce el estado de la cuenta —`activo` o `inactivo`— como un dato más de `public.usuarios`, y lo convierte en una barrera real: la cuenta inactiva no entra, y el `admin` ve el estatus de cada persona en el listado.

El cambio de estatus **no** se hace desde la aplicación: la interfaz de edición del panel de usuarios llegará en un spec posterior. Mientras tanto, el estatus se modifica con un `UPDATE` en el panel de Supabase. Este spec fija el modelo de datos, el bloqueo y la visibilidad.

## Alcance

**Incluido:**

- Nuevo enum `public.estatus_usuario` (`activo`, `inactivo`) y nueva columna `public.usuarios.estatus`, `not null` con default `activo`.
- Trigger en base de datos que sincroniza el estatus con `auth.users.banned_until`: al pasar a `inactivo` la cuenta queda baneada en Supabase Auth; al volver a `activo` se levanta el baneo.
- Comprobación del estatus en el middleware, en **toda** petición con sesión, con cierre de sesión y respuesta 403.
- Página `/cuenta-desactivada` que sirve ese 403 con el aviso correspondiente.
- Columna «Estatus» con badge en la tabla de `/dashboard/admin/users`.
- Selector «Filtrar por estatus» en el buscador de esa misma pantalla, con el filtro aplicado en la consulta.
- Regeneración de `src/lib/database.types.ts` y versionado de la migración en `supabase/migrations/`.
- Verificación con `npm run build`, `npx tsc --noEmit`, `npm run check`, `curl`, Playwright y una modificación real de la base de datos (marcado y restauración).

**Fuera de alcance (para specs futuros):**

- Interfaz para activar o desactivar cuentas: llega con la edición de usuarios en el panel administrativo.
- Suspender, eliminar, cambiar el rol o editar nombre y correo de un usuario.
- Historial o auditoría de los cambios de estatus.
- Aviso por correo al desactivar o al reactivar una cuenta.
- Filtro por rol, ordenación por columnas o exportación del listado.
- Cambios en Supabase Auth más allá del `banned_until` (políticas de contraseña, MFA, límites de sesión).
- Cambios en `src/styles/global.css` (temas), en `src/middleware.ts` fuera de la comprobación de estatus o en las variables de entorno.

## Modelo de datos

### La columna

```sql
create type public.estatus_usuario as enum ('activo', 'inactivo');

alter table public.usuarios
  add column estatus public.estatus_usuario not null default 'activo';
```

- El enum replica el patrón de `public.rol_usuario` de SPEC 02: el estado es un dato del dominio, no un texto libre.
- `not null` con default `activo`: las filas existentes quedan en `activo` al añadir la columna (Postgres reescribe la tabla con el default) y `private.handle_new_user()` —que inserta la fila sin nombrar la columna— sigue creando usuarios activos.
- No hace falta tocar las políticas de RLS: `usuarios_select_own` y `usuarios_select_staff` ya permiten leer la fila completa, y la columna nueva no cambia el alcance de esas políticas.

### El trigger que banea en Supabase Auth

```sql
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

create trigger on_usuarios_estatus_changed
after update of estatus on public.usuarios
for each row
when (old.estatus is distinct from new.estatus)
execute function private.sync_user_estatus();
```

- `security definer` porque el trigger escribe en `auth.users`, que el rol `authenticated` no puede tocar; `set search_path = ''` es la práctica de SPEC 02 para funciones de ese tipo.
- `now() + interval '100 years'` es un baneo permanente: Supabase Auth considera baneado a un usuario con `banned_until` en el futuro. Volver a `activo` deja `banned_until` en `null` y la cuenta vuelve a poder entrar.
- `when (old.estatus is distinct from new.estatus)` evita reescribir `auth.users` en cada actualización de la fila (por ejemplo, al cambiar el nombre).
- El trigger solo reacciona a `UPDATE`. No hay `INSERT`: una cuenta nueva nace en `activo` y no está baneada.

### Los tipos en la aplicación

`src/lib/database.types.ts` se regenera con `generate_typescript_types` del MCP de Supabase: el enum `estatus_usuario` y la columna `estatus` aparecen ya tipados.

```ts
// src/lib/estatus.ts
export type Estatus = Database['public']['Enums']['estatus_usuario'];

export const ESTATUS_INFO: Record<Estatus, { label: string; className: string }> = {
  activo: { label: 'Activo', className: 'badge-success' },
  inactivo: { label: 'Inactivo', className: 'badge-error' }
};
```

`src/lib/estatus.ts` es el gemelo de `src/lib/roles.ts`: un mapa de etiqueta y clase por estado, en `src/lib/` porque lo usan la tabla de usuarios y la comprobación de acceso.

### La fila del solicitante

`getCurrentUser()` (`src/lib/current-user.ts`) pasa a leer también `estatus`, y usa `.maybeSingle()` en lugar de `.single()` para distinguir «no hay fila» de «la consulta falló»:

| Dato | Origen | Uso |
| --- | --- | --- |
| `estatus` | `public.usuarios.estatus` | Decide si la petición se bloquea. |
| `rol` | `public.usuarios.rol` | Autorización de la ruta (sin cambios). |
| `nombre`, `email` | `public.usuarios` | Tarjeta de perfil (sin cambios). |

## Comportamiento del bloqueo

El bloqueo tiene dos capas, porque ninguna de las dos sola cubre todo.

### Capa 1 — Supabase Auth (base de datos)

El trigger deja la cuenta baneada, así que `signInWithPassword` falla y **no se puede iniciar sesión**. Como el usuario está baneado, tampoco puede renovar su token: la sesión muere sola en cuanto intenta refrescarlo.

`POST /api/auth/login` **no se modifica**: hoy responde `error=invalid_credentials` ante cualquier fallo de `signInWithPassword`, de modo que un usuario baneado ve exactamente el mismo mensaje que si se equivoca de contraseña: «Correo o contraseña incorrectos». No se revela que la cuenta existe ni que está desactivada.

### Capa 2 — El middleware (aplicación)

El middleware es el único punto por el que pasan todas las peticiones, así que es donde se comprueba el estatus. En **toda** petición con sesión válida (no solo en `/dashboard/*`), hace lo siguiente:

1. Resuelve la fila del solicitante con `getCurrentUser()` y la deja en `Astro.locals.currentUser`.
2. Si la fila no existe, la petición sigue adelante: es el comportamiento de hoy («No se encontró tu perfil») y no hay estatus que comprobar.
3. Si la lectura **falla**, responde **503** y registra el error en el servidor. Se falla cerrado: sin base de datos no se puede verificar el estatus, y abrir la puerta sería justo el fallo que este spec evita.
4. Si `estatus === 'inactivo'`, cierra la sesión (`supabase.auth.signOut()`, que borra las cookies `httpOnly`) y responde:
   - **Rutas de página**: 302 a `/cuenta-desactivada`, que responde **403** con el aviso «Tu cuenta está desactivada. Contacta con el administrador.» y un enlace al inicio de sesión.
   - **Rutas `/api/*`**: 403 en JSON, `{"error":"Tu cuenta está desactivada. Contacta con el administrador."}`, para no devolver HTML donde el cliente espera JSON.

La ruta `/cuenta-desactivada` está **exenta** de la comprobación: si el cierre de sesión fallara y la cookie sobreviviera, sin la exención la página se redirigiría a sí misma en bucle.

Cerrar la sesión no es un detalle: sin ello, el usuario inactivo seguiría con su cookie y volvería a recibir el mismo 403 en cada página, sin poder alcanzar el login por su cuenta.

### Lo que no cambia

- La **autorización por rol** sigue en el frontmatter de las páginas. El middleware resuelve la fila y comprueba el estatus; no decide permisos de negocio.
- Un usuario `activo` entra y usa la aplicación exactamente igual que antes.
- Un no-`admin` sigue recibiendo 403 en `/dashboard/admin/users`.
- Sin sesión, `/dashboard/*` sigue respondiendo 302 al login.

## El listado de usuarios

### La columna «Estatus»

La tabla de `/dashboard/admin/users` gana una cuarta columna, después de «Rol»:

| Columna | Contenido |
| --- | --- |
| Nombre | `usuario.nombre` |
| Correo | `usuario.email` |
| Rol | Badge con la etiqueta de `ROL_INFO` (sin cambios) |
| **Estatus** | Badge con la etiqueta de `ESTATUS_INFO`: «Activo» (`badge-success`) o «Inactivo» (`badge-error`) |

Se listan **todos** los usuarios, activos e inactivos: el objetivo es que el `admin` vea a quién ha desactivado.

### El filtro por estatus

El buscador de la misma pantalla gana un selector daisyUI `select` con tres opciones:

| Opción | Valor en la URL | Efecto |
| --- | --- | --- |
| Todos | (sin parámetro) | Sin filtro de estatus |
| Activos | `?estatus=activo` | Solo filas con `estatus = 'activo'` |
| Inactivos | `?estatus=inactivo` | Solo filas con `estatus = 'inactivo'` |

- El selector es un campo más del formulario `GET` actual (`?q=` + `?estatus=`). Al enviarlo desaparece el parámetro `page`, así que un filtro nuevo siempre empieza en la página 1.
- Los valores admitidos son una lista blanca: `activo` e `inactivo`. Cualquier otro valor de `?estatus` equivale a «Todos».
- El filtro se aplica **en la consulta** (`.eq('estatus', …)`), tanto en el `count` como en la página de datos, para que el total y las filas siempre coincidan.
- La paginación conserva el filtro: los enlaces arrastran `estatus` igual que arrastran `q`.
- «Quitar filtro» pasa a **«Quitar filtros»** y borra el texto de búsqueda y el filtro de estatus a la vez (enlace a `/dashboard/admin/users`). Con dos filtros, un botón que solo limpia uno deja un resultado inesperado.
- La tabla sigue siendo de **solo lectura**: este spec no añade ningún botón ni enlace de acción sobre un usuario.

## Estructura de archivos

```text
supabase/
└── migrations/
    └── <timestamp>_add_estatus_usuario.sql     # NUEVO: enum + columna + trigger de baneo

src/
├── middleware.ts                                 # MODIFICADO: resolución del solicitante y bloqueo por estatus
├── env.d.ts                                      # MODIFICADO: App.Locals.currentUser
├── lib/
│   ├── current-user.ts                           # MODIFICADO: incluye estatus y usa maybeSingle
│   ├── database.types.ts                         # REGENERADO con el MCP de Supabase
│   ├── estatus.ts                                # NUEVO: tipo Estatus + mapa ESTATUS_INFO
│   └── roles.ts                                  # sin cambios
├── pages/
│   ├── cuenta-desactivada.astro                  # NUEVO: 403 con el aviso de cuenta desactivada
│   ├── dashboard/
│   │   ├── index.astro                           # MODIFICADO: usa locals.currentUser
│   │   └── admin/
│   │       └── users.astro                       # MODIFICADO: lee ?estatus
│   └── api/
│       └── invitations.ts                        # MODIFICADO: usa locals.currentUser.rol
└── features/users/
    ├── components/
    │   ├── AdminUsersPanel.astro                 # MODIFICADO: propaga el filtro de estatus
    │   ├── UsersSearchForm.astro                 # MODIFICADO: selector de estatus y «Quitar filtros»
    │   ├── UsersTable.astro                      # MODIFICADO: columna «Estatus»
    │   └── UsersPagination.astro                 # MODIFICADO: conserva el filtro en los enlaces
    └── lib/
        └── users-list.ts                         # MODIFICADO: filtro de estatus y columna en el select
```

### Contrato de los archivos nuevos y modificados

| Archivo | Responsabilidad |
| --- | --- |
| `supabase/migrations/<timestamp>_add_estatus_usuario.sql` | Enum, columna y trigger de sincronización con `auth.users.banned_until`. |
| `src/lib/estatus.ts` | Tipo `Estatus` y mapa `ESTATUS_INFO` (`{ label, className }`). |
| `src/lib/current-user.ts` | `getCurrentUser()` incluye `estatus` y usa `.maybeSingle()`; distingue «sin fila» de «error». |
| `src/middleware.ts` | Resuelve `Astro.locals.currentUser`, comprueba `estatus`, cierra sesión y responde 403 (o 503 si falla la lectura). |
| `src/env.d.ts` | Declara `App.Locals.currentUser`. |
| `src/pages/cuenta-desactivada.astro` | Responde 403 con el aviso y el enlace al login. |
| `src/pages/dashboard/index.astro` | Lee `Astro.locals.currentUser` en lugar de consultar la fila. La autorización por rol no cambia. |
| `src/pages/dashboard/admin/users.astro` | Lee `?estatus`, lo pasa a `listUsers()` y usa `Astro.locals.currentUser` para el rol. |
| `src/pages/api/invitations.ts` | Comprueba el rol con `Astro.locals.currentUser` en lugar de consultar la fila. |
| `src/features/users/lib/users-list.ts` | `sanitizeEstatusFilter()`, filtro `.eq('estatus', …)` en el count y en la página, `estatus` en `UsuarioListItem` y en `UsersListResult`. |
| `src/features/users/components/UsersSearchForm.astro` | Selector «Filtrar por estatus» y enlace «Quitar filtros». |
| `src/features/users/components/UsersTable.astro` | Columna «Estatus» con badge. |
| `src/features/users/components/UsersPagination.astro` | Añade `estatus` a los enlaces de página. |
| `src/features/users/components/AdminUsersPanel.astro` | Propaga `result.estatus` al buscador y a la paginación. |

## Plan de implementación

1. Escribir `supabase/migrations/<timestamp>_add_estatus_usuario.sql` con el enum, la columna y el trigger, y aplicarla con `apply_migration` del MCP de Supabase. Verificar que las filas existentes quedan en `activo` (`select estatus, count(*) from public.usuarios group by 1`) y que `private.handle_new_user()` sigue creando usuarios activos.
2. Regenerar `src/lib/database.types.ts` con `generate_typescript_types` del MCP. Verificar con `npx tsc --noEmit` que el enum `estatus_usuario` y la columna `estatus` están tipados.
3. Crear `src/lib/estatus.ts` con `Estatus` y `ESTATUS_INFO`. Verificar con `npx tsc --noEmit`.
4. Ampliar `getCurrentUser()` en `src/lib/current-user.ts` para leer `estatus` y usar `.maybeSingle()`. Verificar con `npx tsc --noEmit` y con una llamada desde el servidor de desarrollo.
5. Modificar `src/middleware.ts`: resolver `Astro.locals.currentUser` una sola vez por petición con sesión, comprobar `estatus`, cerrar sesión y responder 403 (página o JSON según la ruta), y responder 503 si la lectura falla. Añadir `currentUser` a `App.Locals` en `src/env.d.ts`. Verificar con `npm run build`, `npx tsc --noEmit` y `npm run check`.
6. Crear `src/pages/cuenta-desactivada.astro` (403, aviso, enlace al login) y eximir esa ruta de la comprobación del middleware. Verificar que se sirve con status 403.
7. Actualizar `src/pages/dashboard/index.astro`, `src/pages/dashboard/admin/users.astro` y `src/pages/api/invitations.ts` para consumir `Astro.locals.currentUser`. La autorización por rol sigue en el frontmatter de las páginas. Verificar con `npm run build` y `curl` que los códigos de respuesta no cambian (200, 403 y 302).
8. Añadir el filtro de estatus al listado: `sanitizeEstatusFilter()` y el filtro `.eq('estatus', …)` en `users-list.ts`, el selector en `UsersSearchForm.astro`, la columna con badge en `UsersTable.astro`, la propagación en `AdminUsersPanel.astro`, los enlaces de `UsersPagination.astro` y la lectura de `?estatus` en `dashboard/admin/users.astro`. Verificar con `npm run build`, `npx tsc --noEmit` y `npm run check`.
9. Verificar el bloqueo contra la base de datos real: marcar un usuario de prueba como `inactivo` (y restaurar después a `activo`), comprobar con `curl` y Playwright que el login falla con el mensaje genérico, que la sesión existente recibe 403 y que las cookies se borran, y que el filtro y la paginación con `?estatus` funcionan sin scroll horizontal a 320 px ni errores de consola.
10. Actualizar `README.md` (estado del proyecto, rutas, árbol de `src/`) y `AGENTS.md` (árbol de `src/` y reglas de acceso).

## Criterios de aceptación

- [x] `npm run build` termina correctamente (solo los avisos no fatales `Invalid empty selector` de daisyUI).
- [x] `npx tsc --noEmit` no reporta errores.
- [x] `npm run check` (`astro check`) no reporta errores en los `.astro`.
- [x] Existe el enum `public.estatus_usuario` con los valores `activo` e `inactivo`.
- [x] `public.usuarios.estatus` es `not null` con default `activo`.
- [x] Todas las filas existentes quedan en `activo` tras aplicar la migración.
- [x] Un usuario nuevo creado por el trigger de SPEC 02 nace en `activo`.
- [x] La migración está versionada en `supabase/migrations/`.
- [x] `src/lib/database.types.ts` incluye el enum `estatus_usuario` y la columna `estatus`.
- [x] Al poner `estatus = 'inactivo'`, `auth.users.banned_until` de ese usuario queda en el futuro.
- [x] Al volver a `estatus = 'activo'`, `auth.users.banned_until` de ese usuario queda en `null`.
- [x] Un usuario con estatus `inactivo` no puede iniciar sesión: el login responde con el mensaje genérico «Correo o contraseña incorrectos» y no se crea sesión.
- [x] Un usuario con estatus `inactivo` que ya tiene sesión recibe 403 y su sesión queda cerrada (las cookies de sesión se borran).
- [x] La respuesta 403 de una página muestra «Tu cuenta está desactivada. Contacta con el administrador.» y un enlace al inicio de sesión.
- [x] Una ruta `/api/*` con sesión inactiva responde 403 en JSON, no HTML.
- [x] Un usuario con estatus `activo` entra y usa `/dashboard` con normalidad: el comportamiento no cambia.
- [x] La autorización por rol no cambia: un usuario que no es `admin` sigue recibiendo 403 en `/dashboard/admin/users` y sin sesión sigue recibiendo 302 al login.
- [x] `/dashboard/admin/users` muestra una columna «Estatus» con badge «Activo» o «Inactivo» en cada fila.
- [x] El selector «Filtrar por estatus» filtra la tabla con `?estatus=activo` y con `?estatus=inactivo`.
- [x] `?estatus` con un valor no válido equivale a «Todos».
- [x] El filtro de estatus se combina con la búsqueda por nombre o correo.
- [x] La paginación conserva el filtro de estatus al cambiar de página.
- [x] Enviar el formulario de búsqueda o el selector de estatus vuelve a la página 1.
- [x] «Quitar filtros» borra a la vez el texto de búsqueda y el filtro de estatus.
- [x] El total que muestra el contador («Mostrando X–Y de Z usuarios») corresponde a las filas del filtro aplicado.
- [x] La tabla no contiene ningún botón ni enlace de acción sobre un usuario.
- [x] A 320 px no hay scroll horizontal en `/dashboard/admin/users`.
- [x] No hay errores de consola en `/dashboard/admin/users`.
- [x] `README.md` y `AGENTS.md` reflejan la nueva columna, el bloqueo de cuentas inactivas y el árbol final de `src/`.

## Decisiones tomadas y descartadas

- **Sí:** enum `public.estatus_usuario` con los valores `activo` e `inactivo`. Replica el patrón de `rol_usuario` de SPEC 02 y hace imposible un estado inválido.
- **No:** columna booleana `activo`. Se pierde el nombre del estado en la base de datos y no encaja con el vocabulario «estatus» que ya usa el laboratorio.
- **No:** `text` con un `CHECK`. No es un enum de Postgres: no aparece en `database.types.ts` como tipo y admite conversiones implícitas.
- **Sí:** `inactivo` con una sola `n`. Es la ortografía estándar y la que se usa en el enum, en los tipos y en toda la aplicación.
- **Sí:** la columna es `not null` con default `activo`. Las filas existentes y las cuentas nuevas quedan activas sin tocar nada.
- **Sí:** el bloqueo tiene dos capas: trigger en base de datos (`banned_until`) y comprobación en el middleware.
  - Solo en la base de datos no da efecto inmediato: el token ya emitido sigue siendo válido hasta una hora, y las rutas que usan la clave secreta no se ven afectadas.
  - Solo en la aplicación no revoca el token en Supabase Auth: el usuario conserva la sesión en el proveedor y puede recuperarla si la aplicación cambia.
- **No:** meter el estatus en el JWT mediante *custom claims*. El claim viajaría obsoleto hasta que se renueve el token (hasta una hora) y obligaría a configurar un hook de Auth en el panel de Supabase.
- **Sí:** la comprobación se hace en **toda** petición con sesión, no solo en `/dashboard/*`. `POST /api/invitations` usa la clave secreta y no pasa por RLS: comprobarla solo en las páginas dejaría esa ruta abierta.
- **Sí:** el middleware resuelve la fila del solicitante una sola vez y la expone en `Astro.locals.currentUser`; las páginas y las rutas de API la reutilizan. Una sola consulta por petición y `getCurrentUser()` sigue siendo el único lector de la fila del solicitante.
- **No:** dejar la consulta de perfil en las páginas y añadir una segunda consulta solo para el estatus en el middleware. Leería dos veces la misma fila en cada petición autenticada.
- **Sí:** la autorización por rol sigue en el frontmatter de las páginas. El middleware resuelve la fila y comprueba el estatus; no decide permisos de negocio.
- **Sí:** al bloquear se cierra la sesión además de responder 403. Sin cerrar la sesión, el usuario conserva la cookie y recibe el mismo 403 en cada página sin poder llegar al login.
- **Sí:** el login no se toca. `POST /api/auth/login` ya responde `error=invalid_credentials` ante cualquier fallo, así que la cuenta baneada ve el mismo mensaje que una contraseña incorrecta.
- **No:** un mensaje propio («tu cuenta está desactivada») en el login. Revelaría qué correos existen en el sistema a quien no es el titular de la cuenta.
- **Sí:** el 403 de página se sirve en una ruta propia, `/cuenta-desactivada`, que responde con status 403. El middleware no puede renderizar el layout de la aplicación.
- **No:** devolver HTML plano desde el middleware. Perdería el layout y los estilos de la aplicación.
- **Sí:** si la lectura del estatus falla, se responde 503. Se falla cerrado: sin base de datos no se puede verificar el estatus.
- **No:** dejar pasar la petición cuando falla la lectura. Abriría la puerta al usuario desactivado justo en el momento en que el sistema no puede comprobarlo.
- **No:** bloquear solo las rutas protegidas `/dashboard/*`. Dejaría accesibles las rutas de API con la clave secreta.
- **Sí:** el filtro de estatus se aplica en la consulta, en el `count` y en la página de datos, no en memoria. Si se filtrara en memoria, el total y las filas no coincidirían y la paginación mostraría páginas vacías.
- **Sí:** `?estatus` es una lista blanca (`activo`, `inactivo`). Cualquier otro valor equivale a «Todos», sin errores.
- **Sí:** «Quitar filtro» pasa a «Quitar filtros» y borra texto y estatus a la vez. Con dos filtros, un botón que solo limpia uno deja un resultado inesperado.
- **Sí:** la columna «Estatus» va después de «Rol», con badge de color (`badge-success` / `badge-error`).
- **No:** interfaz para activar o desactivar usuarios en este spec. El usuario decidió que llegará con la edición del panel administrativo; mientras tanto el estatus se cambia con un `UPDATE` en el panel de Supabase.
- **No:** mostrar el estatus en la tarjeta de perfil de `/dashboard`. Es información de administración, no del perfil propio.
- **No:** auditoría de los cambios de estatus. No hay forma de cambiarlo desde la aplicación todavía, así que un historial no tendría valor.
- **Sí:** el trigger solo actúa ante `UPDATE` y solo cuando el valor cambia. Una cuenta nueva nace en `activo` y no está baneada.

## Riesgos

| Riesgo | Mitigación |
| --- | --- |
| El trigger no puede escribir en `auth.users` (permisos) y el `UPDATE` de `estatus` falla | La función es `security definer` con `set search_path = ''`; tras aplicar la migración se verifica que cambiar el estatus no devuelve error y que `banned_until` cambia. |
| El token ya emitido sigue siendo válido hasta una hora | El middleware lo neutraliza en la siguiente petición, y el baneo impide renovar el token en Supabase Auth. |
| Un fallo puntual de la base de datos deja la aplicación inaccesible para los usuarios con sesión | Se responde 503 (fail closed) en lugar de dejar pasar al usuario; es preferible a abrir la puerta a una cuenta desactivada. |
| Quedarse sin ningún `admin` activo | No hay interfaz de cambio de estatus: si se desactiva al único administrador, hay que reactivarlo con un `UPDATE` en el panel de Supabase. Riesgo aceptado en este spec; la interfaz de edición lo resolverá. |
| El filtro de estatus desincroniza el total y las filas | El mismo `.eq('estatus', …)` se aplica en `countUsers()` y en `fetchUsersPage()`. |
| Cualquier actualización de la fila dispara el trigger | `when (old.estatus is distinct from new.estatus)`. |
| El cierre de sesión en el middleware falla y la cookie sobrevive | La ruta `/cuenta-desactivada` está exenta de la comprobación, así que no hay bucle de redirección; además se verifica que tras el 403 la siguiente petición no tiene sesión. |
| La cuenta baneada ve un error técnico de Supabase en el login | `POST /api/auth/login` traduce cualquier error a `error=invalid_credentials`; no se muestra el código de error de Supabase. |

## Qué **no** entra en este spec

- Interfaz para activar, desactivar o editar usuarios (llega en el spec de edición del panel administrativo).
- Suspender, eliminar, cambiar el rol o editar nombre y correo de un usuario.
- Historial o auditoría de los cambios de estatus.
- Correos de aviso al desactivar o al reactivar una cuenta.
- Filtro por rol, ordenación por columnas o exportación del listado a CSV.
- Búsqueda insensible a acentos.
- Recuperación de contraseña y registro público.
- Menú lateral, breadcrumbs o cualquier otro sistema de navegación.
- Cambios en las políticas de Supabase Auth, en `src/styles/global.css`, en las variables de entorno o en `src/lib/roles.ts`.

## Verificación

> **Ejecutada tras la implementación (2026-11-12).** Sesiones obtenidas con `auth.admin.generateLink` + `verifyOtp` (no envía correo). Para probar el bloqueo se crearon 13 usuarios temporales (1 para el login y 12 para forzar la paginación), se marcaron como `inactivo`, se restauraron y se borraron al final: la base de datos queda con sus 3 usuarios reales, todos en `activo` y sin baneo.

| Criterio | Estado | Evidencia | Notas |
| --- | --- | --- | --- |
| `npm run build` termina correctamente | ✅ | `npm run build` → `Complete!` | Solo los 2 avisos no fatales `Invalid empty selector` de daisyUI |
| `npx tsc --noEmit` no reporta errores | ✅ | Sin salida, código 0 | — |
| `npm run check` no reporta errores | ✅ | `Result (32 files): 0 errors, 0 warnings, 0 hints` | — |
| Existe el enum `public.estatus_usuario` | ✅ | `pg_enum`: `estatus_usuario` → `activo`, `inactivo` | — |
| `public.usuarios.estatus` es `not null` con default `activo` | ✅ | `information_schema.columns`: `is_nullable = NO`, `column_default = 'activo'::estatus_usuario` | — |
| Las filas existentes quedan en `activo` | ✅ | Las 3 filas previas a la migración (`charly`, `jaime`, `luis`) están en `activo` | — |
| Un usuario nuevo nace en `activo` | ✅ | 13 usuarios creados con `auth.admin.createUser`: las 13 filas de `public.usuarios` nacieron en `activo` | El trigger `private.handle_new_user()` no nombra la columna y hereda el default |
| La migración está versionada | ✅ | `supabase/migrations/20261112185401_add_estatus_usuario.sql` | — |
| `database.types.ts` incluye el enum y la columna | ✅ | `Enums.estatus_usuario: "activo" \| "inactivo"` y `estatus` en `Row`/`Insert`/`Update` | — |
| `inactivo` deja `banned_until` en el futuro | ✅ | `UPDATE public.usuarios SET estatus = 'inactivo'` → `auth.users.banned_until = 2126-11-13T02:13:18Z` (+100 años) | El trigger `security definer` con `search_path = ''` escribe sin error |
| `activo` deja `banned_until` en `null` | ✅ | Tras `UPDATE ... SET estatus = 'activo'`: `banned_until = null` | El mismo `UPDATE` restauró el acceso: el login volvió a funcionar |
| Una cuenta inactiva no puede iniciar sesión | ✅ | `POST /api/auth/login` con la contraseña correcta de la cuenta desactivada → 302 a `/auth/login?error=invalid_credentials`, **sin `Set-Cookie`** | La página muestra «Correo o contraseña incorrectos», el mismo mensaje que con una contraseña errónea |
| Una sesión activa de una cuenta inactiva recibe 403 y se cierra | ✅ | `GET /dashboard` → 302 a `/cuenta-desactivada` con `Set-Cookie: sb-…-auth-token=; Max-Age=0` | En Playwright la cookie desaparece del navegador: `cookies: []` |
| La página 403 muestra el aviso y el enlace al login | ✅ | `/cuenta-desactivada` → 403 con «Tu cuenta está desactivada. Contacta con el administrador.» y `href="/auth/login"` | El enlace lleva al login sin bucle de redirección |
| Una ruta `/api/*` con sesión inactiva responde 403 en JSON | ✅ | `POST /api/invitations` → 403, `Content-Type: application/json`, `{"error":"Tu cuenta está desactivada. Contacta con el administrador."}` | No devuelve HTML |
| Un usuario `activo` usa `/dashboard` con normalidad | ✅ | `GET /dashboard` → 200 con «Tu perfil», `jaime`, `jaime@google.com` y el badge «Administrador» | La tarjeta de perfil no muestra el estatus (fuera de alcance) |
| La autorización por rol no cambia | ✅ | Sesión de `supervisor` en `/dashboard/admin/users` → 403 con «Acceso denegado…» y 0 filas; sin sesión → 302 a `/auth/login?next=%2Fdashboard%2Fadmin%2Fusers` | — |
| La columna «Estatus» con badge | ✅ | `<thead>`: `Nombre`, `Correo`, `Rol`, `Estatus`; cada fila con `badge badge-success` «Activo» o `badge badge-error` «Inactivo» | Con 12 cuentas inactivas: 10 filas con `badge-error` y 0 con `badge-success` |
| El selector filtra por `?estatus=` | ✅ | `?estatus=activo` → 4 filas, todas «Activo»; `?estatus=inactivo` → 10 filas, todas «Inactivo» | El `<select id="users-estatus">` marca la opción activa |
| Un `?estatus` no válido equivale a «Todos» | ✅ | `?estatus=basura` → 16 filas, igual que sin filtro | `sanitizeEstatusFilter()` devuelve `null` |
| El filtro se combina con la búsqueda | ✅ | `?q=jaime&estatus=activo` → 1 fila; `?q=Temporal&estatus=inactivo` → 12 filas | — |
| La paginación conserva el filtro | ✅ | `?estatus=inactivo` → «Siguiente» apunta a `?estatus=inactivo&page=2`; con búsqueda, `?q=Temporal&estatus=inactivo&page=2` | Los enlaces arrastran `q` y `estatus` |
| Enviar el formulario o el selector vuelve a la página 1 | ✅ | Desde `?estatus=inactivo&page=2`: al enviar el selector → `?q=&estatus=inactivo` («Mostrando 1–10»); al enviar la búsqueda → `?q=Temporal&estatus=inactivo` | El formulario es `GET` con los campos `q` y `estatus`, sin `page` |
| «Quitar filtros» borra texto y estatus | ✅ | Enlace con texto «Quitar filtros» y `href="/dashboard/admin/users"`; tras pulsarlo: campo de búsqueda vacío y selector en «Todos» | — |
| El contador corresponde al filtro | ✅ | `?estatus=activo` → «Mostrando 1–4 de 4 usuarios»; `?estatus=inactivo` → «Mostrando 1–10 de 12 usuarios»; página 2 → «Mostrando 11–12 de 12 usuarios» | El `.eq('estatus', …)` se aplica en el `count` y en la página de datos |
| La tabla no tiene acciones sobre un usuario | ✅ | 0 elementos `table td a`, `table td button` o `table td form` | Los únicos botones de la página son «Cerrar sesión» y «Buscar» |
| Sin scroll horizontal a 320 px | ✅ | Playwright a 320×640: `scrollWidth === clientWidth === 305` en `/dashboard/admin/users` | La tabla se desborda dentro de su contenedor `overflow-x-auto`, sin arrastrar la página |
| Sin errores de consola | ✅ | `consoleErrors: []` en `/dashboard/admin/users` (320 px y 1280 px) | En `/cuenta-desactivada` el navegador anota el 403 como recurso, no es un error de la aplicación |
| `README.md` y `AGENTS.md` al día | ✅ | Los dos describen el enum, la columna, el trigger, el bloqueo en dos capas, `/cuenta-desactivada`, el filtro `?estatus=` y el árbol final de `src/` | — |

### Comprobaciones adicionales

| Comprobación | Estado | Evidencia |
| --- | --- | --- |
| El trigger solo actúa si el valor cambia | ✅ | `pg_get_triggerdef`: `AFTER UPDATE OF estatus … WHEN ((old.estatus IS DISTINCT FROM new.estatus))` |
| El trigger es `security definer` con `search_path` vacío | ✅ | `pg_proc`: `prosecdef = true`, `proconfig = {"search_path=\"\""}` |
| La función coincide con la del spec | ✅ | `pg_get_functiondef` devuelve exactamente el `case when new.estatus = 'inactivo' then now() + interval '100 years' else null end` del spec |
| El baneo impide renovar el token | ✅ | `POST /auth/v1/token?grant_type=refresh_token` con el refresh token de la cuenta baneada → 400 `user_banned` | La sesión muere sola aunque el token de acceso siga siendo válido hasta una hora |
| El cierre de sesión borra la cookie del navegador | ✅ | Tras el 403, Playwright no muestra ninguna cookie de sesión (`cookies: []`) y `/dashboard` sin cookie responde 302 al login | — |
| La ruta exempta no se redirige a sí misma | ✅ | `/cuenta-desactivada` responde 403 con o sin sesión | — |
| Matiz del cierre de sesión | ⚠️ | La cookie se borra y el refresh token es rechazado por el baneo, pero las filas de `auth.sessions` no se borran: GoTrue responde 403 `user_banned` a `/logout` para una cuenta baneada y `auth-js` lo trata como «ya cerrada» | El token de acceso sigue siendo válido hasta una hora, pero el navegador ya no lo envía (cookie borrada) y no se puede renovar. No afecta a ningún criterio: el usuario no puede volver a entrar |
| `/api/invitations` sigue exigiendo rol de `admin` | ✅ | Sin sesión → 401 `{"error":"No autorizado."}`; con sesión de `supervisor` → 403 `{"error":"Se requiere rol de administrador."}` | La comprobación usa `Astro.locals.currentUser.rol` |
| El middleware resuelve la fila del solicitante una sola vez | ✅ | `src/middleware.ts` llama a `getCurrentUser()` una vez por petición con sesión y expone `Astro.locals.currentUser`; `dashboard/index.astro`, `dashboard/admin/users.astro` y `api/invitations.ts` lo reutilizan | — |
| La base de datos queda como estaba | ✅ | Tras la prueba: 3 usuarios en `public.usuarios`, los 3 en `activo`, 0 baneados en `auth.users`, 0 cuentas temporales | Las 13 cuentas temporales se borraron con `auth.admin.deleteUser` (la FK `on delete cascade` eliminó sus perfiles) |
| La tabla y la API no escriben en `public.usuarios` | ✅ | El listado solo llama a `listUsers()`; el único `UPDATE` de estatus se hizo a mano, como una prueba | — |
