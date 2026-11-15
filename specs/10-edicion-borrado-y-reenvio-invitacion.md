# SPEC 10 — Edición, reenvío de invitación y borrado de usuarios

> **Estado:** Implementado
> **Depende de:** SPEC 02, SPEC 07, SPEC 08, SPEC 09
> **Fecha:** 2026-11-13
> **Objetivo:** Permitir que un `admin` administre las personas de la tabla de `/dashboard/admin/users`: editar su nombre, rol y estatus, reenviar la invitación a las cuentas que aún no han validado su correo y eliminar definitivamente una cuenta.

## Por qué existe este spec

El área de administración de usuarios lleva tres specs encima (SPEC 07 el listado, SPEC 08 el estatus, SPEC 09 el alta) y sigue siendo, en la práctica, **de solo lectura**. El `admin` puede dar de alta a alguien, pero no puede corregir un nombre mal escrito, ascender a un capturador, desactivar a quien se fue del laboratorio ni revocar la cuenta de alguien que se marchó: para todo eso hay que abrir el panel de Supabase.

Además, hay un hueco que ninguna de las specs anteriores cubrió: **la cuenta invitada pero nunca activada**. La fila de `public.usuarios` aparece en la tabla en cuanto se genera el enlace, pero el listado no la distingue de una cuenta en uso, así que el `admin` ve a una persona que «existe» y no sabe si esa persona llegó a entrar. El enlace de invitación caduca a la hora, así que cuando la persona avisa de que no le llegó el correo, el `admin` no tiene ninguna opción desde la aplicación: tiene que volver a crear la cuenta.

Este spec cierra las tres carencias con un patrón único: un botón de icono de Lucide por fila en la tabla, un `<dialog>` de daisyUI con los datos precargados y una ruta de API que hace la escritura en el servidor.

## Alcance

**Incluido:**

- Botón de **editar** (icono de Lucide) por usuario en la tabla de `/dashboard/admin/users`.
- Modal de edición con los datos **precargados**: nombre, rol y estatus. El correo aparece en solo lectura, con la explicación de que para cambiarlo hay que eliminar la cuenta y crear otra.
- Modal de **eliminación definitiva** (icono de Lucide) con un aviso previo que destaca la alternativa de **cambiar solo el estatus**.
- Botón de **reenviar invitación** (icono de Lucide) para las cuentas que **no han validado su correo**: vuelve a generar el enlace de invitación y envía el correo.
- Estado de invitación visible en la tabla: insignia «Pendiente» / «Confirmada» y fecha del último envío.
- **Autoprotección del `admin`**: nadie puede cambiar su propio rol, su propio estatus ni eliminarse. Un `admin` sí puede editar por completo a otro `admin`.
- Rutas de API de servidor para las tres operaciones, con validación de entrada y códigos de respuesta documentados.
- Migración que añade el estado de confirmación del correo a `public.usuarios`.
- Actualización de `README.md` y `AGENTS.md`.

**Fuera de alcance (para specs futuros):**

- Envío de invitaciones en lote.
- Historial de cambios (quién editó a quién y cuándo).
- Reenvío de la invitación a una cuenta **ya confirmada** (eso es recuperación de contraseña, no invitación).
- Filtro por rol en el listado, ordenación por columnas o exportación a CSV.
- Recuperación de contraseña y registro público.
- Permisos granulares por acción (solo `admin` puede todo hoy).
- Envío de correos al usuario cuando se le cambia el rol o el estatus.
- Menú lateral, breadcrumbs o cualquier otro sistema de navegación.
- Cambios en `src/styles/global.css` (temas), en `src/middleware.ts` o en las variables de entorno.

## Modelo de datos

### Cambios en el esquema

`public.usuarios` necesita saber si la persona llegó a validar su correo y cuándo se le envió la última invitación. Hoy no hay ningún dato que lo distinga: el listado solo puede mostrar «la fila existe».

```sql
alter table public.usuarios
  add column email_confirmado boolean not null default false,
  add column invitado_at timestamptz;
```

| Columna | Tipo | Significado |
| --- | --- | --- |
| `email_confirmado` | `boolean not null default false` | `true` cuando la persona validó su correo. Es lo que decide si se puede reenviar la invitación. |
| `invitado_at` | `timestamptz` | Fecha del último envío de invitación. `null` si la cuenta no fue invitada desde la aplicación. |

El origen de la verdad es `auth.users`: `email_confirmed_at` (la marca de confirmación del correo) y `invited_at` (la fecha que escribe GoTrue al generar el enlace). Se sincronizan con un trigger, **igual que ya hace** `on_usuarios_estatus_changed` con `estatus` ↔ `auth.users.banned_until`:

```sql
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

create trigger on_auth_user_invitation_changed
after update of email_confirmed_at, invited_at on auth.users
for each row
when (old.email_confirmed_at is distinct from new.email_confirmed_at
   or old.invited_at is distinct from new.invited_at)
execute function private.sync_user_invitation();
```

El trigger escribe `email_confirmado` e `invitado_at`, que no aparecen en la lista de columnas del `UPDATE` de `on_usuarios_estatus_changed`, así que **no hay recursión** entre triggers.

La migración incluye además un **backfill** para las filas que ya existen, que se rellenan con el estado real de `auth.users`.

### Qué escribe cada dato

| Dato | Lo escribe | Cuándo |
| --- | --- | --- |
| `public.usuarios.email_confirmado` | Trigger `on_auth_user_invitation_changed` | Cuando GoTrue confirma el correo (la persona pulsa el enlace) |
| `public.usuarios.invitado_at` | Trigger `on_auth_user_invitation_changed` | Cuando se genera el enlace de invitación (alta o reenvío) |
| `public.usuarios.nombre` | El servidor (`UPDATE` con clave secreta) | Al editar desde el modal |
| `public.usuarios.rol` | El servidor (`UPDATE` con clave secreta) | Al editar desde el modal |
| `public.usuarios.estatus` | El servidor (`UPDATE` con clave secreta) | Al editar desde el modal |

`public.usuarios.email` **no se puede editar**: es la clave de la cuenta en `auth.users` y la referencia de `auth.admin`. Cambiarlo desde la aplicación exigiría reescribir `auth.users.email` y su Trigger de sincronización (`private.sync_user_email`), con el riesgo de dejar la cuenta huérfana. La regla es la que pidió el laboratorio: **si hace falta otro correo, se elimina la cuenta y se crea otra**.

### El tipo del listado

`UsuarioListItem` (en `src/features/users/lib/users-list.ts`) crece con los dos campos nuevos:

```ts
export type UsuarioListItem = {
  id: string;
  nombre: string;
  email: string;
  rol: Rol;
  estatus: Estatus;
  email_confirmado: boolean;
  invitado_at: string | null;
};
```

### Las listas blancas

`src/lib/estatus.ts` pasa a exportar `ESTATUS_VALUES` (`readonly Estatus[]` = `['activo', 'inactivo']`), igual que `src/lib/roles.ts` exporta `ROL_VALUES`. Es la **única** fuente de verdad y la usan tanto la validación del servidor como los `select` de los formularios.

## Comportamiento

### Los botones de la fila

La tabla gana dos columnas: **Invitación** y **Acciones**.

| Columna | Contenido |
| --- | --- |
| Invitación | Insignia «Pendiente» (`badge-warning`) si `email_confirmado` es `false`, «Confirmada» (`badge-ghost`) si es `true`. Cuando está pendiente, debajo va la fecha del último envío («Invitación enviada el 12/11/2026»). |
| Acciones | Tres botones de icono (`btn btn-ghost btn-xs btn-square`) con `aria-label` y `title`: editar, reenviar invitación y eliminar. |

| Botón | Icono de Lucide | Cuándo aparece |
| --- | --- | --- |
| Editar | `Pencil` | Siempre. |
| Reenviar invitación | `Send` | Solo si `email_confirmado` es `false`. |
| Eliminar | `Trash2` | Siempre, salvo en la fila del propio `admin` (deshabilitado, con `title` «No puedes eliminar tu propia cuenta»). |

Los botones son `<button type="button">` con atributos `data-*` (`data-user-id`, `data-user-nombre`, `data-user-email`, `data-user-rol`, `data-user-estatus`, `data-user-confirmado`) que el `<script>` de cada modal lee para precargar su contenido. No hay peticiones para abrir un modal: la tabla ya tiene todos los datos.

### El modal de edición

Un `<dialog id="users-edit-modal" class="modal">` (patrón de daisyUI 5 ya usado en `UsersInviteModal.astro`) con un formulario de cuatro campos:

| Campo | Control | Valor inicial | Notas |
| --- | --- | --- | --- |
| Nombre | `input type="text"` | Nombre de la fila | `required`, `maxlength="120"`. |
| Correo electrónico | `input type="email" readonly` | Correo de la fila | No editable, con una nota bajo el campo: «El correo no se puede editar. Si necesitas cambiarlo, elimina esta cuenta y crea otra con el nuevo correo.» |
| Rol | `select` | Rol de la fila | Opciones de `ROL_VALUES` con las etiquetas de `ROL_INFO`. |
| Estatus | `select` | Estatus de la fila | Opciones `Activo` / `Inactivo` de `ESTATUS_INFO`. |

Cuando la fila editada es **la del `admin` que está operando**, el modal muestra un aviso (`alert alert-info`) con el texto «No puedes cambiar tu propio rol ni tu estatus.» y los dos `select` quedan deshabilitados. Solo se puede cambiar el nombre. El botón «Guardar cambios» envía únicamente `{ nombre }` en ese caso.

Botones: «Cancelar» (cierra el diálogo) y «Guardar cambios» (envía el `PATCH`). Durante el envío, el botón pasa a `btn-loading` y se deshabilita.

### El modal de reenvío de invitación

Un `<dialog id="users-resend-modal" class="modal">` con el texto «Se enviará una nueva invitación a **{correo}**. El enlace anterior deja de funcionar y el nuevo caduca en 1 hora.» y dos botones: «Cancelar» y «Reenviar invitación» (`btn btn-primary`).

Al confirmar, el servidor regenera el enlace y envía el correo. El resultado (éxito o error) se muestra en el propio modal, igual que en `UsersInviteModal.astro`.

### El modal de eliminación

Un `<dialog id="users-delete-modal" class="modal">` con:

- El texto «Vas a eliminar definitivamente a **{nombre}** ({correo}). Se borrará su cuenta y no podrá volver a entrar.»
- Un aviso destacado (`alert alert-warning`) con la alternativa: **«Si solo necesitas quitarle el acceso, cambia su estatus a «Inactivo»: la cuenta se conserva y puede reactivarse después.»**
- Dos botones: «Cancelar» y «Eliminar definitivamente» (`btn btn-error`).

El aviso es informativo: el atajo para cambiar el estatus se hace desde el modal de edición, que está a un clic de distancia.

### La recarga del listado

Tras una operación correcta (edición, reenvío o eliminación) la página se recarga con `window.location.reload()`, igual que hace `UsersInviteModal.astro`. Como la recarga respeta la URL actual, **se conservan la búsqueda, el filtro de estatus y la página** de la paginación.

### Las rutas de API

Tres operaciones, todas con el mismo control de acceso: sin sesión → `401`; con una sesión que no es de `admin` → `403`. El rol se comprueba con `locals.currentUser?.rol !== 'admin'`, igual que en `POST /api/invitations`.

#### `PATCH /api/users/[id]` — editar

| Campo del cuerpo | Obligatorio | Regla |
| --- | --- | --- |
| `nombre` | Sí | 1–120 caracteres tras `trim` (el mismo límite que el `check` de la base de datos). |
| `rol` | No | Lista blanca `ROL_VALUES`. |
| `estatus` | No | Lista blanca `ESTATUS_VALUES`. |

Al menos uno de los tres campos debe venir en el cuerpo. Se permiten actualizaciones parciales: el modal de la propia cuenta envía solo `nombre`.

La escritura usa el cliente con clave secreta (`service_role`, bypass de RLS), el mismo criterio que SPEC 09 aplicó al `UPDATE` del perfil: **no se abre ninguna política de escritura en RLS**.

El cambio de `estatus` dispara el trigger `on_usuarios_estatus_changed`, que mantiene `auth.users.banned_until` sincronizado: una cuenta que pasa a «inactivo» queda baneada y su sesión muere en la siguiente petición (SPEC 08).

| Código | Cuándo | Cuerpo |
| --- | --- | --- |
| `200` | Cambio aplicado | `{ "ok": true }` |
| `400` | Datos inválidos | `{ "error": "…" }` |
| `401` | Sin sesión | `{ "error": "No autorizado." }` |
| `403` | No es `admin`, o intenta cambiar su propio rol o estatus | `{ "error": "…" }` |
| `404` | La cuenta no existe | `{ "error": "No se encontró el usuario." }` |
| `500` | Fallo de Supabase | `{ "error": "No se pudo guardar el cambio." }` |

#### `DELETE /api/users/[id]` — eliminar

Borra la cuenta con `auth.admin.deleteUser(id)`, que **en cascada** elimina la fila de `public.usuarios` (la clave foránea es `on delete cascade`).

| Código | Cuándo | Cuerpo |
| --- | --- | --- |
| `200` | Cuenta eliminada | `{ "ok": true }` |
| `401` | Sin sesión | `{ "error": "No autorizado." }` |
| `403` | No es `admin`, o intenta eliminarse a sí mismo | `{ "error": "No puedes eliminar tu propia cuenta." }` |
| `404` | La cuenta no existe | `{ "error": "No se encontró el usuario." }` |
| `500` | Fallo de Supabase | `{ "error": "No se pudo eliminar el usuario." }` |

#### `POST /api/users/[id]/reinvite` — reenviar la invitación

1. Se lee el perfil de `public.usuarios` con el cliente admin.
2. Si `email_confirmado` es `true` → `409`: esa cuenta ya validó su correo y no tiene una invitación pendiente.
3. Se genera un enlace nuevo con `auth.admin.generateLink({ type: 'invite', email })`.
4. Se envía el correo con `sendInviteEmail` (el mismo saludo por el nombre de SPEC 09).

| Código | Cuándo | Cuerpo |
| --- | --- | --- |
| `200` | Invitación reenviada | `{ "ok": true }` |
| `401` | Sin sesión | `{ "error": "No autorizado." }` |
| `403` | No es `admin` | `{ "error": "Se requiere rol de administrador." }` |
| `404` | La cuenta no existe | `{ "error": "No se encontró el usuario." }` |
| `409` | La cuenta ya validó su correo | `{ "error": "Esta cuenta ya validó su correo." }` |
| `500` | Fallo al generar el enlace o al enviar el correo | `{ "error": "No se pudo reenviar la invitación." }` |

### El enlace de invitación y una cuenta que ya existe

`auth.admin.generateLink({ type: 'invite' })` **no falla** cuando el correo ya tiene una cuenta sin confirmar: GoTrue reutiliza ese usuario, renueva su `confirmation_token` y actualiza `invited_at`. Solo devuelve `email_exists` cuando la cuenta **ya está confirmada**, que es exactamente el caso que este endpoint rechaza con un `409` propio.

Por eso el reenvío **no borra y recrea** la cuenta: conserva el mismo `id`, el mismo `nombre` y el mismo `rol`, y no toca ninguna otra cuenta. El `UPDATE` del perfil no hace falta en este camino.

### La autoprotección del `admin`

Se comprueba en el servidor, comparando el `id` de la ruta con `locals.claims.sub` (el mismo UUID que `public.usuarios.id`):

- No se puede cambiar el **propio** rol ni el **propio** estatus (`403`).
- No se puede **eliminar** la propia cuenta (`403`).

Como nadie puede eliminarse a sí mismo, **siempre queda al menos un `admin`** en el sistema. Un `admin` sí puede editar a otro `admin` por completo: nombre, rol y estatus.

La comprobación vive en la API, no en el formulario: el modal deshabilita los campos por cortesía, pero la garantía es del servidor.

### La escritura y las RLS

Las tres operaciones se ejecutan con el cliente de clave secreta (`SUPABASE_SECRET_API_KEY`), que autoriza como `service_role`: `bypassrls` y permiso de `UPDATE`/`DELETE` comprobados en el proyecto. Por eso **no hace falta ninguna política de escritura en RLS** y la tabla mantiene solo la de `select` para `authenticated`.

La clave secreta se sigue leyendo únicamente desde `src/features/invitations/lib/supabase-admin.ts`, y solo desde rutas de API: nunca desde páginas ni desde scripts que se envían al cliente.

## Estructura de archivos

```text
src/
├── lib/
│   └── estatus.ts                                # MODIFICADO: añade ESTATUS_VALUES (lista blanca)
├── pages/
│   └── api/
│       └── users/
│           ├── [id].ts                           # NUEVO: PATCH (editar) y DELETE (eliminar)
│           └── [id]/
│               └── reinvite.ts                   # NUEVO: POST (reenviar la invitación)
└── features/
    ├── invitations/
    │   └── lib/
    │       └── invitations.ts                    # MODIFICADO: generaInviteLink() reutilizado por el alta y el reenvío
    └── users/
        ├── components/
        │   ├── AdminUsersPanel.astro             # MODIFICADO: renderiza los tres modales y pasa el id del solicitante
        │   ├── UsersTable.astro                  # MODIFICADO: columna Invitación y columna Acciones con iconos
        │   ├── UsersEditModal.astro              # NUEVO: modal de edición con datos precargados
        │   ├── UsersDeleteModal.astro            # NUEVO: modal de eliminación con el aviso previo
        │   └── UsersResendModal.astro            # NUEVO: modal de reenvío de la invitación
        └── lib/
            ├── users-admin.ts                    # NUEVO: validación y escrituras de usuario con clave secreta
            └── users-list.ts                     # MODIFICADO: email_confirmado e invitado_at en el listado
```

### Contrato de los archivos nuevos y modificados

| Archivo | Responsabilidad |
| --- | --- |
| `src/lib/estatus.ts` | `ESTATUS_VALUES`: lista blanca de estatus, usada por el servidor y por el `select`. |
| `src/features/users/lib/users-admin.ts` | `parseUserUpdateInput()` (valida el cuerpo del `PATCH`), `findUserProfile()` (lee el perfil con clave secreta), `updateUserProfile()` y `deleteUserAccount()`. |
| `src/features/invitations/lib/invitations.ts` | `generateInviteLink()`: genera el enlace de invitación con `generateLink` y devuelve el `tokenHash`. `createInvitedUser()` pasa a usarla, de modo que el alta y el reenvío hablan con GoTrue en un único sitio. |
| `src/pages/api/users/[id].ts` | Enrutado del `PATCH` y del `DELETE`: comprobación de sesión y rol, autoprotección, llamada a la librería y respuesta JSON. |
| `src/pages/api/users/[id]/reinvite.ts` | Enrutado del reenvío: lee el perfil, rechaza las cuentas ya confirmadas, genera el enlace y envía el correo. |
| `src/features/users/lib/users-list.ts` | Selecciona `email_confirmado` e `invitado_at` y los expone en `UsuarioListItem`. |
| `src/features/users/components/UsersTable.astro` | Columnas «Invitación» y «Acciones», botones de icono y datos precargados en `data-*`. |
| `src/features/users/components/UsersEditModal.astro` | El `<dialog>` de edición y su `<script>`. |
| `src/features/users/components/UsersDeleteModal.astro` | El `<dialog>` de eliminación y su `<script>`. |
| `src/features/users/components/UsersResendModal.astro` | El `<dialog>` de reenvío y su `<script>`. |
| `src/features/users/components/AdminUsersPanel.astro` | Renderiza los tres modales en la rama autorizada y baja el `currentUserId` hasta la tabla. |

## Plan de implementación

1. Crear la migración `supabase/migrations/20261113201404_add_email_confirmado.sql` con las dos columnas, el trigger `on_auth_user_invitation_changed` y el backfill. Regenerar `src/lib/database.types.ts` con el MCP de Supabase. Verificar con `npx tsc --noEmit`.
2. Añadir `ESTATUS_VALUES` a `src/lib/estatus.ts`. Verificar con `npx tsc --noEmit`.
3. Modificar `src/features/users/lib/users-list.ts` para seleccionar `email_confirmado` e `invitado_at` y añadirlos a `UsuarioListItem`. Verificar con `npx tsc --noEmit`.
4. Crear `src/features/users/lib/users-admin.ts` con `parseUserUpdateInput()`, `findUserProfile()`, `updateUserProfile()` y `deleteUserAccount()`. Verificar con `npx tsc --noEmit`.
5. Extraer `generateInviteLink()` en `src/features/invitations/lib/invitations.ts` y hacer que `createInvitedUser()` lo use. Verificar con `npx tsc --noEmit` y `npm run build`.
6. Crear `src/pages/api/users/[id].ts` con el `PATCH` y el `DELETE`. Verificar con `npx tsc --noEmit` y `npm run build`.
7. Crear `src/pages/api/users/[id]/reinvite.ts`. Verificar con `npx tsc --noEmit` y `npm run build`.
8. Modificar `src/features/users/components/UsersTable.astro`: columna «Invitación», columna «Acciones» y los tres botones de icono. Verificar con `npm run build` y `npm run check`.
9. Modificar `src/features/users/components/AdminUsersPanel.astro` y `src/pages/dashboard/admin/users.astro` para pasar el `currentUserId` y renderizar los tres modales. Verificar con `npm run build` y `npm run check`.
10. Crear `src/features/users/components/UsersEditModal.astro`. Verificar con `npm run build`, `npm run check` y `npx tsc --noEmit`.
11. Crear `src/features/users/components/UsersDeleteModal.astro` y `src/features/users/components/UsersResendModal.astro`. Verificar con `npm run build`, `npm run check` y `npx tsc --noEmit`.
12. Actualizar `README.md` (estado del proyecto, API, rutas, estructura) y `AGENTS.md` (árbol de `src/`, lista de specs 01–10).

## Criterios de aceptación

- [x] `npm run build` termina correctamente (solo los avisos no fatales `Invalid empty selector` de daisyUI).
- [x] `npx tsc --noEmit` no reporta errores.
- [x] `npm run check` (`astro check`) no reporta errores en los `.astro`.
- [x] La migración añade `email_confirmado` e `invitado_at` a `public.usuarios`, y el backfill deja las filas existentes con el estado real de `auth.users`.
- [x] Cuando una persona confirma su correo, `public.usuarios.email_confirmado` pasa a `true` sin intervención manual.
- [x] Con sesión de `admin`, `/dashboard/admin/users` muestra un botón de icono de Lucide por usuario para editar, reenviar y eliminar.
- [x] Con sesión de un usuario que no es `admin`, la página responde 403 y su HTML no contiene los botones de acción ni los tres modales.
- [x] El botón de editar abre un `<dialog class="modal">` con los datos de esa persona precargados: nombre, correo, rol y estatus.
- [x] El correo aparece en solo lectura y el modal explica que para cambiarlo hay que eliminar la cuenta y crear otra.
- [x] El `select` de rol ofrece exactamente las tres etiquetas de `ROL_INFO` y el de estatus las de `ESTATUS_INFO`.
- [x] «Guardar cambios» envía `PATCH /api/users/<id>` con `{ nombre, rol, estatus }` y, con éxito, recarga el listado conservando búsqueda, filtro y página.
- [x] Un nombre de más de 120 caracteres o un `rol`/`estatus` fuera de la lista blanca devuelven `400` y no modifican nada.
- [x] El `PATCH` sobre la propia cuenta con `rol` o `estatus` en el cuerpo devuelve `403` y no modifica nada.
- [x] Editando la propia cuenta, el modal muestra el aviso y los `select` de rol y estatus están deshabilitados.
- [x] Un `admin` puede cambiar el rol y el estatus de **otro** `admin`.
- [x] El botón de eliminar abre un modal con el aviso previo que destaca que la alternativa es cambiar solo el estatus.
- [x] «Eliminar definitivamente» envía `DELETE /api/users/<id>` y, con éxito, la persona desaparece del listado.
- [x] `DELETE` sobre la propia cuenta devuelve `403` y no borra nada.
- [x] El botón de reenviar invitación solo aparece en las cuentas con `email_confirmado = false`.
- [x] «Reenviar invitación» envía `POST /api/users/<id>/reinvite` y, con éxito, muestra el aviso de confirmación en el modal.
- [x] `POST /api/users/<id]/reinvite` sobre una cuenta ya confirmada devuelve `409` y no envía ningún correo.
- [x] Tras el reenvío, la cuenta conserva su `id`, su `nombre` y su `rol` en `public.usuarios`, y `invitado_at` se actualiza.
- [x] `PATCH /api/users/<id]` responde `401` sin sesión y `403` con una sesión que no es de `admin`.
- [x] `PATCH /api/users/[id]` y `DELETE /api/users/[id]` con un `id` inexistente devuelven `404`.
- [x] Cambiar el estatus a «inactivo» deja la cuenta baneada: la siguiente petición con su sesión responde 403 (SPEC 08).
- [x] El `PATCH` no puede cambiar el correo: el correo no forma parte de los campos aceptados.
- [x] A 320 px no hay scroll horizontal en la página con `/dashboard/admin/users` (la tabla puede scrollear dentro de su contenedor `overflow-x-auto`).
- [x] No hay errores de consola al abrir y usar los tres modales.
- [x] `README.md` y `AGENTS.md` reflejan las tres acciones, las rutas de API nuevas y el árbol final de `src/`.

## Decisiones tomadas y descartadas

- **Sí:** los tres modales viven en `src/features/users/components/`, junto a la tabla que los abre, y siguen la familia `Users*` (`UsersSearchForm`, `UsersTable`, `UsersPagination`, `UsersInviteModal`).
- **No:** un único modal con varias vistas para las tres acciones. Cada operación tiene un formulario, un mensaje y una ruta distintos; un modal común terminaría con un `switch` de casos y datos de tres operaciones en la misma vista.
- **Sí:** un `<dialog>` de HTML con clases de daisyUI 5, el mismo patrón que `UsersInviteModal.astro`: foco atrapado, `ESC` y clic fuera sin código extra.
- **Sí:** los botones de acción son iconos de Lucide (`Pencil`, `Send`, `Trash2`) con `aria-label` y `title`, porque la columna «Acciones» es un espacio estrecho y los iconos son el lenguaje habitual de las tablas de administración.
- **No:** un menú desplegable (`⋮`) por fila. Ocultaría las acciones detrás de un clic extra y complicaría el caso más frecuente (editar).
- **Sí:** el reenvío se ofrece a **cualquier cuenta sin confirmar**, no solo a las que la invitación caducó hace más de una hora. La caducidad es invisible para el `admin` y el botón funciona igual en ambos casos.
- **Sí:** guardar `invitado_at` aunque el reenvío no dependa de él. La fecha del último envío es la información que le dice al `admin` si una persona lleva dos semanas sin activar la cuenta o si la invitación se acaba de mandar.
- **Sí:** el estado de invitación se guarda en `public.usuarios` con un trigger desde `auth.users`, en lugar de consultarse a `auth.users` en cada carga de la página. La clave secreta no se usa desde páginas (regla del proyecto) y la tabla necesita el dato para pintar la insignia sin una petición extra.
- **No:** añadir una columna `pendiente` calculada por la aplicación. El estado true es `email_confirmed_at is null`, que es un dato de GoTrue: duplicarlo en una columna calculada añadiría una fuente de verdad que puede desincronizarse.
- **Sí:** la escritura de `nombre`, `rol` y `estatus` usa el cliente con clave secreta, sin abrir políticas de escritura en RLS. Es el mismo criterio que aplicó SPEC 09 al escribir el perfil del invitado, y evita exponer la tabla a escrituras del rol `authenticated`.
- **Sí:** el cambio de `estatus` se hace con un `UPDATE` normal, sin tocar el trigger `on_usuarios_estatus_changed`. El trigger se encarga de `banned_until` sin que la aplicación tenga que saber de él.
- **No:** borrar y recrear la cuenta para reenviar la invitación. GoTrue ya renueva el `confirmation_token` de una cuenta sin confirmar conservando su `id`, su `nombre` y su `rol`; recrearla perdería datos y cambiaría el identificador.
- **Sí:** el correo no se puede editar y el modal lo explica. Editar `auth.users.email` exigiría reescribir la clave de la cuenta y su trigger de sincronización, con el riesgo de dejar cuentas huérfanas. La regla acordada es borrar y crear otra.
- **Sí:** la autoprotección se limita a la **propia cuenta**. Un `admin` puede editar por completo a otro `admin` (nombre, rol y estatus): el laboratorio necesita poder corregir el rol de un compañero administrador.
- **No:** bloquear el rol y el estatus de *cualquier* `admin`. Exigiría una cuenta de servicio aparte para poder administrar al equipo administrador, y no está en el modelo del laboratorio.
- **No:** impedir que un `admin` se elimine a sí mismo pero sí permitir que otro `admin` lo elimine. Sería una puerta de fuga del último administrador. Con la regla actual siempre queda un `admin` en el sistema.
- **Sí:** la autoprotección se comprueba en el servidor comparando el `id` de la ruta con `locals.claims.sub`. El `id` de `public.usuarios` es el mismo UUID de `auth.users`, así que la comparación es exacta y no necesita tocar `current-user.ts`.
- **Sí:** tras cada operación se recarga la página. Es el mismo criterio que `UsersInviteModal.astro` y conserva el estado de la URL (búsqueda, filtro y paginación) sin mantener estado en el cliente.
- **No:** actualizar la tabla en el cliente con un `fetch` parcial tras cada acción. Exigiría duplicar la lógica de paginación, filtro y orden en JavaScript, que hoy vive en el servidor.
- **Sí:** el aviso de eliminación menciona la alternativa de cambiar el estatus, sin ofrecer un atajo que la ejecute. El modal de edición está a un clic y cambiar el estatus es reversible; eliminar no lo es.
- **No:** pedir que se escriba el correo del usuario para confirmar el borrado. Es una fricción extra para un caso raro en un laboratorio pequeño, y el aviso previo ya cubre el error.

## Riesgos

| Riesgo | Mitigación |
| --- | --- |
| El trigger sobre `auth.users` no dispara y la insignia «Pendiente» miente | El trigger replica el patrón ya probado de `on_usuarios_estatus_changed`; la verificación incluye confirmar una invitación de prueba y comprobar que `email_confirmado` pasa a `true`. |
| El backfill deja el estado equivocado en las filas anteriores a la migración | El backfill lee `auth.users.email_confirmed_at` directamente; se verifica con una consulta de contraste entre ambas tablas. |
| `generateLink` devolviera `email_exists` en el reenvío | El comportamiento de GoTrue está verificado en su código fuente: una cuenta sin confirmar reutiliza el usuario y renueva el token; solo falla si está confirmada, y ese caso se rechaza con `409` antes de generar el enlace. |
| El `UPDATE` de `estatus` no propaga el baneo | El trigger `on_usuarios_estatus_changed` existe desde SPEC 08 y dispara con cualquier `UPDATE` de la columna, venga del cliente o de la clave secreta. Se verifica iniciando sesión con la cuenta desactivada. |
| Un `admin` deja el sistema sin administradores | Nadie puede eliminarse a sí mismo ni cambiar su propio rol: siempre queda al menos un `admin`. |
| La tabla se ensancha y roza el scroll horizontal en móvil | El contenedor `overflow-x-auto` ya existía; a 320 px la página no hace scroll horizontal, solo la tabla dentro de su contenedor. |
| Se envía un correo por accidente al pulsar «Reenviar invitación» | El botón abre un modal de confirmación antes de llamar a la API, igual que el modal de alta. |
| El estado «Pendiente» se queda obsoleto si alguien confirma el correo por otra vía | Solo hay una vía de confirmación (el enlace del correo) y pasa por GoTrue, que dispara el trigger. |

## Qué **no** entra en este spec

- Envío de invitaciones en lote.
- Historial de cambios (quién editó a quién y cuándo).
- Reenvío de invitación a una cuenta **ya confirmada** (eso es recuperación de contraseña).
- Recuperación de contraseña y registro público.
- Filtro por rol en el listado, ordenación por columnas o exportación a CSV.
- Permisos granulares por acción (hoy todo es `admin`).
- Correo de aviso al usuario cuando se le cambia el rol o el estatus.
- Menú lateral, breadcrumbs o cualquier otro sistema de navegación.
- Cambios en `src/styles/global.css` (temas), en `src/middleware.ts` o en las variables de entorno.

## Verificación

> Ejecutada el 2026-11-14 sobre la rama `spec-10-edicion-borrado-y-reenvio-invitacion` (`99b9fec`). Método: servidor de desarrollo (`npx astro dev`), Playwright (sesión real de `admin`), MCP de Supabase en modo lectura, `npm run build`, `npx tsc --noEmit` y `npm run check`.
>
> **Mutaciones autorizadas y revertidas.** Para probar el 403 de un no-`admin`, el baneo por estatus, el `DELETE` real y la confirmación del correo se crearon tres cuentas efímeras (`e2e-verificacion@example.com`, `e2e-confirmacion@example.com`, `e2e-admin@example.com`) y se promovió `charly@google.com` a `admin` de forma temporal. Todas se borraron o revirtieron: el estado final es 5 cuentas reales, 1 `admin`, 0 filas temporales y `public.usuarios` en sync con `auth.users` (5/5). Único efecto permanente: `jimmyraq@gmail.com.invitado_at` pasó a `2026-11-14 13:12:40 UTC` por el reenvío real autorizado.

| Criterio | Estado | Evidencia | Notas |
| --- | --- | --- | --- |
| `npm run build` termina correctamente | ✅ | `BUILD_EXIT=0`; solo los 2 avisos no fatales `Invalid empty selector` de daisyUI 5.7.50 | — |
| `npx tsc --noEmit` no reporta errores | ✅ | `TSC_EXIT=0`, sin salida | — |
| `npm run check` no reporta errores | ✅ | `astro check` → «Result (40 files): 0 errors, 0 warnings, 0 hints», `CHECK_EXIT=0` | — |
| La migración y el backfill dejan el estado correcto | ✅ | MCP: `public.usuarios` tiene `email_confirmado boolean not null default false` e `invitado_at timestamptz`; el trigger `on_auth_user_invitation_changed` existe sobre `auth.users` con el `when` del spec. Contraste de las 5 filas: `email_confirmado = (a.email_confirmed_at is not null)` y `invitado_at IS NOT DISTINCT FROM a.invited_at` → 5/5 coinciden | — |
| Confirmar el correo pasa `email_confirmado` a `true` | ✅ | Cuenta efímera `e2e-confirmacion@example.com`: tras `generateLink` el perfil quedó `email_confirmado=false`, `invitado_at=13:14:15`; al abrir `/auth/confirm?token_hash=…&type=invite` (redirección a `/auth/update-password`) el trigger puso `email_confirmado=true` (13:14:20) sin intervención manual | Cuenta borrada al terminar |
| Los botones de icono aparecen para el `admin` y no para los demás | ✅ | Sesión `admin`: 6 botones `data-accion="editar"`, 1 `data-accion="reenviar"` (solo la cuenta sin confirmar) y 6 `data-accion="eliminar"`. Sesión `capturador`: `GET /dashboard/admin/users` → **403** y el HTML **no** contiene `users-edit-modal`, `users-delete-modal`, `users-resend-modal`, `users-invite-modal`, ni `data-accion="editar\|eliminar\|reenviar"`, ni la tabla; muestra «Acceso denegado» | — |
| El modal de edición precarga los datos y bloquea rol/estatus propios | ✅ | Playwright: `#users-edit-modal` con `nombre`, `email` (`readonly=true`), `rol` y `estatus` iguales a los de la fila; `select` de rol = Capturador/Supervisor/Administrador y de estatus = Activo/Inactivo (exactamente `ROL_INFO` y `ESTATUS_INFO`). En la fila propia: aviso visible «No puedes cambiar tu propio rol ni tu estatus.» y ambos `select` con `disabled=true` | — |
| El `PATCH` valida el cuerpo y protege la propia cuenta | ✅ | `nombre` de 121 caracteres → 400; `rol` inválido → 400; `estatus` inválido → 400; `nombre` vacío → 400; cuerpo no-JSON → 400; `PATCH` sobre la propia cuenta con `rol` → 403 «No puedes cambiar tu propio rol ni tu estatus.»; con `estatus` → 403; `email` en el cuerpo → 200 y el correo **no** cambió en `public.usuarios` ni en `auth.users` | Los 400/403 no modificaron ninguna fila (consulta de contraste posterior) |
| El modal de eliminación avisa de la alternativa del estatus | ✅ | Texto «Vas a eliminar definitivamente a Jimmy Raq (jimmyraq@gmail.com). Se borrará su cuenta y no podrá volver a entrar.» + `alert alert-warning` «Si solo necesitas quitarle el acceso, cambia su estatus a «Inactivo»: la cuenta se conserva y puede reactivarse después.»; botones «Cancelar» y «Eliminar definitivamente» (`btn-error`) | — |
| El `DELETE` borra la cuenta y protege la propia | ✅ | `DELETE` sobre la propia cuenta → 403 «No puedes eliminar tu propia cuenta.»; `DELETE` de un id inexistente → 404. `DELETE` real desde el modal sobre la cuenta efímera → 200; la tabla pasó de 6 a 5 filas y el correo desapareció; en cascada quedaron 0 filas en `auth.users` y 0 en `public.usuarios` para ese id | Cuenta efímera, borrada por la propia app |
| El reenvío solo se ofrece a cuentas sin confirmar y conserva el `id` | ✅ | El botón `Send` solo aparece en la fila con `email_confirmado=false`; `POST /api/users/<id>/reinvite` sobre una cuenta confirmada → **409** «Esta cuenta ya validó su correo.» (sin correo) y sobre un id inexistente → 404. Reenvío real a `jimmyraq@gmail.com` → 200 `{"ok":true}`, el modal muestra «Invitación reenviada.» y ofrece «Cerrar y ver el listado»; en `auth.users` se renovaron `confirmation_token`, `confirmation_sent_at` e `invited_at` (13:12:40) y el trigger propagó `invitado_at` a `public.usuarios`; `id`, `nombre` y `rol` intactos | Comportamiento de GoTrue contrastado con su fuente (`internal/api/mail.go`, rama `InviteVerification`: reutiliza el usuario no confirmado y renueva el token; solo devuelve `email_exists` si está confirmado) |
| Sin scroll horizontal a 320 px y sin errores de consola | ✅ | Viewport 320 px: `documentElement.scrollWidth (305) === clientWidth (305)` → la página no scrollea; la tabla sí, dentro de su contenedor `overflow-x-auto` (663 px de contenido en 225 px visibles). Playwright: 0 errores y 0 avisos de consola al abrir y cerrar los tres modales | — |
| `README.md` y `AGENTS.md` al día | ✅ | `README.md`: sección «Edición, reenvío de invitación y borrado de usuarios» con las tres acciones, la tabla de códigos de respuesta, las tres rutas de API y ejemplos `curl`; el árbol de `src/` incluye `UsersEditModal`/`UsersDeleteModal`/`UsersResendModal`, `users-admin.ts` y `api/users/**`; se retira el pendiente «Gestión de usuarios dentro del panel». `AGENTS.md`: árbol actualizado, `ESTATUS_VALUES`, `users-admin.ts`, `on_auth_user_invitation_changed` y las reglas de seguridad de `/api/users/**` | — |

### Matices de la verificación

- **Códigos extra:** `GET /api/users/<id>` y `PUT` devuelven `405` con la cabecera `Allow`, y un `id` que no es un UUID devuelve `404` (no se filtra el formato del identificador).
- **Códigos de la API con sesión de `capturador`:** `PATCH`, `DELETE` y `POST .../reinvite` devuelven `403` «Se requiere rol de administrador.» (no `401`, porque sí hay sesión).
- **Códigos de la API sin sesión:** los tres devuelven `401` «No autorizado.».
- **Reenvío con una cuenta ya confirmada:** se rechaza con `409` **antes** de generar el enlace, así que no sale ningún correo; además, si GoTrue devolviera `email_exists`, el endpoint lo mapea al mismo `409`.
- **`email_confirmado` y `invitado_at`:** el único disparador es `on_auth_user_invitation_changed` sobre `auth.users`; no hay recursión con `on_usuarios_estatus_changed` porque cada uno escribe columnas que el otro no toca.
- **Estado final de la base de datos tras la verificación:** 5 usuarios en `auth.users` y 5 perfiles en `public.usuarios`, 1 `admin` (`jaime@google.com`), 0 cuentas de prueba y las 5 filas sincronizadas con `auth.users`.
