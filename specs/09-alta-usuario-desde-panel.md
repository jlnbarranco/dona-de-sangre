# SPEC 09 — Alta de usuario desde el panel administrativo

> **Estado:** Implementado
> **Depende de:** SPEC 03, SPEC 06, SPEC 07, SPEC 08
> **Fecha:** 2026-11-12
> **Objetivo:** Permitir que un `admin` dé de alta a una persona del laboratorio desde `/dashboard/admin/users`: un modal con nombre, correo y rol, un paso previo de confirmación de los datos y el envío de la invitación por correo reutilizando el procedimiento ya implementado (`POST /api/invitations`).

## Por qué existe este spec

SPEC 07 trajo el listado de usuarios y SPEC 08 el estatus de las cuentas, pero el área de administración sigue siendo **de solo lectura**: la tabla no tiene ninguna acción sobre una persona. El alta de usuarios existe, pero solo como endpoint HTTP: `POST /api/invitations` genera el enlace y envía el correo, y su única forma de usarlo es un `curl` manual con la clave de sesión del administrador (el README lo documenta así). Para el laboratorio, esto significa que incorporates a alguien al equipo requiere abrir una terminal.

Este spec pone esa operación en la pantalla donde el `admin` ya está mirando: un botón «Agregar usuario» que abre un modal con el formulario, una pantalla de confirmación con los datos a la vista y, tras confirmar, el envío de la invitación con el rol elegido.

El flujo de aceptación de la cuenta **no cambia**: la persona recibe el correo, confirma su correo y define su contraseña. Este spec solo añade la interfaz del primer paso y le da al `admin` la posibilidad de decidir el rol de la persona desde el propio formulario.

## Alcance

**Incluido:**

- Botón «Agregar usuario» en la cabecera de la tarjeta de `/dashboard/admin/users`, visible solo para el rol `admin`.
- Modal (daisyUI `dialog`) con un formulario de tres campos: **Nombre**, **Correo electrónico** y **Rol**.
- **Paso previo de confirmación**: antes de enviar nada, se muestran los tres datos introducidos y se pide una confirmación explícita.
- Envío de la invitación reutilizando `POST /api/invitations`, que se amplía para aceptar `nombre` y `rol`.
- Asignación del rol elegido en `public.usuarios` desde el servidor, con la lista blanca de roles y con borrado compensatorio si la escritura falla.
- Saludo con el nombre en el correo de invitación.
- Estados de éxito y de error dentro del modal, y recarga del listado al terminar.
- Actualización de `README.md` y `AGENTS.md`.

**Fuera de alcance (para specs futuros):**

- Editar, cambiar de rol, desactivar o eliminar un usuario ya dado de alta.
- Marcar visualmente a las personas que aún no han aceptado la invitación.
- Revocar una invitación pendiente o reenviarla.
- Envío de invitaciones en lote.
- Recuperación de contraseña y registro público.
- Migraciones en base de datos, cambios en RLS o en las políticas de Supabase Auth.
- Cambios en `src/styles/global.css` (temas), en `src/middleware.ts` o en las variables de entorno.

## Modelo de datos

**No hay cambios en el esquema.** `public.usuarios` ya tiene `nombre`, `email` y `rol` (SPEC 02), y `rol` es un enum con tres valores (`admin`, `supervisor`, `capturador`).

Lo que cambia es quién escribe cada campo y en qué momento:

| Dato | Lo escribe | Cuándo |
| --- | --- | --- |
| `auth.users.email` | `auth.admin.generateLink` | Al generar el enlace de invitación |
| `public.usuarios.email` | Trigger `on_auth_user_created` | En cascada del `INSERT` en `auth.users` |
| `public.usuarios.nombre` | El servidor (`UPDATE`) | Después de generar el enlace |
| `public.usuarios.rol` | El servidor (`UPDATE`) | Después de generar el enlace |

El trigger de SPEC 02 (`private.handle_new_user()`) inserta la fila con `nombre` = metadato `nombre` o la parte local del correo, y `rol` = `capturador` (valor por defecto del enum). El `UPDATE` posterior del servidor sobreescribe `nombre` y `rol` con los valores que el `admin` confirmó, de modo que el resultado final es exactamente el que se vio en la pantalla de confirmación.

### Por qué el rol se guarda con un `UPDATE` del servidor

La alternativa era extender el trigger para que leyera el rol de `raw_user_meta_data` (los metadatos que se envían a `generateLink`). Se descartó:

- **Los metadatos los puede escribir quien crea el usuario en Supabase Auth**, no solo el `admin` que usa esta pantalla. Si el trigger confiara en ellos para decidir el rol, cualquiera que pudiera crear un usuario en Auth (por ejemplo, un registro público si el proveedor de correo estuviera abierto) podría pedirse `admin` para sí mismo. El rol es una decisión de autorización: solo puede tomarla el `admin` que llama a la API.
- **Un `UPDATE` es atómico y explícito**: una sola escritura con los dos valores confirmados en pantalla, sin depender del orden entre el trigger y la aplicación.

### Por qué la escritura no necesita tocar RLS

La escritura usa el cliente con clave secreta (`SUPABASE_SECRET_API_KEY`), que autoriza como el rol `service_role` de Postgres. En este proyecto se comprobó que `service_role` tiene `rolbypassrls = true` y permiso `UPDATE` sobre `public.usuarios`, así que la operación no pasa por las políticas de RLS y **no hay que crear ninguna política de escritura**. El `admin` sigue siendo el único que puede llegar a esa ruta: la comprobación de rol vive en la API.

### La lista blanca de roles

`src/lib/roles.ts` pasa a exportar también `ROL_VALUES` (`readonly Rol[]`), que es la **única** fuente de verdad sobre qué roles existen y cuáles se aceptan:

- La validación del servidor (lista blanca: cualquier otro valor es un `400`).
- El `select` del formulario (las etiquetas siguen saliendo de `ROL_INFO`).

## Comportamiento

### El botón

En la cabecera de la tarjeta de `/dashboard/admin/users`, junto al título, hay un botón «Agregar usuario» (`btn btn-primary btn-sm`). Solo se renderiza en la rama autorizada del panel: un usuario que no es `admin` recibe un 403 y el botón no aparece en el HTML. Es un `<button type="button">`, no un enlace: abre un diálogo, no navega.

### El modal

Se usa el elemento `<dialog>` de HTML con las clases de daisyUI 5 (`modal`, `modal-box`, `modal-action`, `modal-backdrop`), que es el patrón que recomienda la propia librería:

- Se abre con `showModal()` (foco atrapado dentro del diálogo, `ESC` para cerrar y clic fuera mediante el `form method="dialog"` del fondo).
- El contenido tiene tres vistas y solo una visible a la vez.
- Al cerrarlo, el formulario se vacía y el modal vuelve al paso 1: la siguiente invitación empieza limpia.

### Paso 1 — Formulario

| Campo | Control | Validación en el navegador | Valor por defecto |
| --- | --- | --- | --- |
| Nombre | `input type="text"` | `required`, `maxlength="120"` | — |
| Correo electrónico | `input type="email"` | `required` | — |
| Rol | `select` | `required` | `capturador` |

Las opciones del `select` son las tres de `ROL_VALUES`, con la etiqueta de `ROL_INFO` («Capturador», «Supervisor», «Administrador») y en orden de menor a mayor privilegio.

La validación del navegador es la de HTML5 (`required`, `type="email"`, `maxlength`): el botón «Revisar datos» no avanza si falta un campo o el correo no tiene forma de correo. El servidor vuelve a validar todo: la validación del cliente es una comodidad, no una barrera.

Al pulsar «Revisar datos» se pasa al paso 2 **sin enviar nada**.

### Paso 2 — Confirmación

Muestra los tres datos tal y como se van a guardar, con una barra de progreso daisyUI (`steps`: «Datos» → «Confirmación») y dos botones:

- **«Volver a editar»**: regresa al paso 1 con los valores intactos.
- **«Enviar invitación»**: performs la llamada a la API y pasa al paso 3.

Nada se escribe en la base de datos hasta pulsar este botón: es el sentido del paso previo.

### Paso 3 — Resultado

- **Éxito**: un aviso `alert-success` con el texto «Invitación enviada a {correo}» y un botón «Cerrar y ver el listado» que cierra el modal y recarga la página, para que la persona recién dada de alta aparezca en la tabla.
- **Error**: un aviso `alert alert-error` con el mensaje que devuelve la API y un botón «Volver a editar» para corregir los datos.

Durante el envío, el botón «Enviar invitación» pasa a estado de carga (`btn-loading`) y se deshabilita, para que no se pueda enviar dos veces.

### La llamada

El modal envía un `fetch` a `POST /api/invitations` con `Content-Type: application/json` y el cuerpo `{ nombre, email, rol }`. Es una petición del mismo origen, así que viaja la cookie de sesión `httpOnly` sin tocar el código del cliente.

### La API ampliada

`POST /api/invitations` pasa a aceptar dos campos nuevos, ambos **opcionales** para no romper el `curl` que documenta el README:

| Campo | Obligatorio | Regla |
| --- | --- | --- |
| `email` | Sí | Patrón de correo; se guarda en minúsculas |
| `nombre` | No | 1–120 caracteres tras `trim` (el mismo límite que el `check` de la base de datos). Si falta, se usa la parte local del correo |
| `rol` | No | Lista blanca `ROL_VALUES`. Si falta, `capturador` |

Códigos de respuesta:

| Código | Cuándo | Cuerpo |
| --- | --- | --- |
| `200` | Invitación enviada | `{ "ok": true }` |
| `400` | `email`, `nombre` o `rol` no válidos | `{ "error": "…" }` |
| `401` | Sin sesión | `{ "error": "No autorizado." }` |
| `403` | La sesión no es de un `admin` | `{ "error": "Se requiere rol de administrador." }` |
| `409` | El correo ya tiene cuenta | `{ "error": "No se pudo generar la invitación." }` (genérico, como hoy) |
| `500` | Fallo al generar el enlace, al guardar el perfil o al enviar el correo | `{ "error": "…" }` |

El `401` y el `403` no cambian: los comprueba el middleware y la comparación de `Astro.locals.currentUser.rol`.

### El borrado compensatorio

`generateLink` crea el usuario en Supabase Auth, y con él la fila de `public.usuarios`. Si el `UPDATE` posterior (el que fija `nombre` y `rol`) falla, esa cuenta se queda creada pero con el rol por defecto y sin correo recibido: un estado a medias que el `admin` no puede arreglar desde la aplicación. Para evitarlo, cuando el `UPDATE` falla se **borra el usuario recién creado** (`auth.admin.deleteUser`, que en cascada elimina su fila de `public.usuarios`) y se responde `500`. El `admin` puede reintentar con el mismo correo sin encontrar restos.

El borrado es un intento más: si también falla, se registra el error en el servidor y se responde `500` igualmente. Nunca se responde `200` con un perfil a medias.

### El correo

`sendInviteEmail` recibe el nombre de la persona y saluda con él («Hola, María, te hemos invitado a crear tu cuenta en Dona de Sangre»). La parte HTML escapa ese valor antes de interpolarlo. El resto del correo (enlace, caducidad de 1 hora, aviso de que no contiene contraseña) no cambia.

### Lo que ve el `admin` después de invitar

La fila de `public.usuarios` la crea el trigger en el momento en que se genera el enlace, así que **la persona aparece en el listado aunque todavía no haya confirmado su correo**. Es el comportamiento real del modelo de datos (la cuenta existe; lo que falta es que la persona la active), pero el listado no distingue entre «invitada» y «activa». Este spec no añade ese indicador: solo lo deja documentado.

## Estructura de archivos

```text
src/
├── lib/
│   └── roles.ts                                  # MODIFICADO: añade ROL_VALUES (lista blanca)
├── pages/
│   └── api/
│       └── invitations.ts                        # MODIFICADO: delega y devuelve 200/400/409/500
└── features/
    ├── invitations/
    │   └── lib/
    │       ├── email.ts                          # MODIFICADO: saludo con el nombre + escape HTML
    │       ├── invitations.ts                    # NUEVO: validación del payload y alta del usuario
    │       └── supabase-admin.ts                 # sin cambios
    └── users/
        └── components/
            ├── AdminUsersPanel.astro             # MODIFICADO: botón «Agregar usuario» en la cabecera
            └── UsersInviteModal.astro            # NUEVO: modal, formulario, confirmación y resultado
```

### Contrato de los archivos nuevos y modificados

| Archivo | Responsabilidad |
| --- | --- |
| `src/lib/roles.ts` | `ROL_VALUES`: lista blanca de roles, usada por el servidor y por el `select`. |
| `src/features/invitations/lib/invitations.ts` | `parseInviteInput()` (valida y normaliza el cuerpo) y `createInvitedUser()` (genera el enlace, guarda `nombre` y `rol`, borra el usuario si falla la escritura). |
| `src/pages/api/invitations.ts` | Enrutado: comprobación de sesión y rol, llamada a la librería, envío del correo y respuesta JSON. |
| `src/features/invitations/lib/email.ts` | `sendInviteEmail()` acepta el nombre y lo usa en el saludo (HTML escapado). |
| `src/features/users/components/UsersInviteModal.astro` | El `<dialog>` con sus tres vistas y el `<script>` que gestiona apertura, pasos y envío. |
| `src/features/users/components/AdminUsersPanel.astro` | Renderiza el botón y el modal solo en la rama autorizada. |

## Plan de implementación

1. Añadir `ROL_VALUES` a `src/lib/roles.ts`. Verificar con `npx tsc --noEmit`.
2. Crear `src/features/invitations/lib/invitations.ts` con `parseInviteInput()` y `createInvitedUser()`: validación de `email`, `nombre` y `rol`; `generateLink`; `UPDATE` de `public.usuarios` con el cliente admin; borrado compensatorio si la escritura falla. Verificar con `npx tsc --noEmit`.
3. Modificar `src/pages/api/invitations.ts` para delegar en la librería y devolver `400` en los datos inválidos, conservando el `401`, el `403` y el `409` genérico. Verificar con `npx tsc --noEmit` y `npm run build`.
4. Modificar `src/features/invitations/lib/email.ts` para aceptar el nombre, saludar con él y escapar el valor en la parte HTML. Verificar con `npx tsc --noEmit`.
5. Crear `src/features/users/components/UsersInviteModal.astro` con el `<dialog>`, el formulario, la vista de confirmación y la de resultado, más el `<script>` que gestiona la apertura, los pasos y el `fetch`. Verificar con `npm run build`, `npx tsc --noEmit` y `npm run check`.
6. Añadir el botón «Agregar usuario» y el modal a `src/features/users/components/AdminUsersPanel.astro`, solo en la rama autorizada. Verificar con `npm run build` y `npm run check` que el HTML de un no-`admin` no contiene el botón.
7. Verificar con Playwright (sesión de `admin`): el modal abre, la validación nativa bloquea los datos incompletos, la confirmación muestra los tres datos, el error del servidor se muestra en el modal y no hay scroll horizontal a 320 px ni errores de consola.
8. Prueba real de extremo a extremo, **con el correo que indicará el usuario**: crear la persona con el rol elegido, comprobar que el correo llega con su nombre y que la fila aparece en `public.usuarios` con el rol correcto.
9. Actualizar `README.md` (estado del proyecto, API, rutas, estructura) y `AGENTS.md` (árbol de `src/`, lista de specs 01–09).

## Criterios de aceptación

- [x] `npm run build` termina correctamente (solo los avisos no fatales `Invalid empty selector` de daisyUI).
- [x] `npx tsc --noEmit` no reporta errores.
- [x] `npm run check` (`astro check`) no reporta errores en los `.astro`.
- [x] Con sesión de `admin`, `/dashboard/admin/users` muestra un botón «Agregar usuario».
- [x] Con sesión de un usuario que no es `admin`, la página responde 403 y su HTML no contiene el botón «Agregar usuario» ni el modal.
- [x] El botón abre un modal (elemento `<dialog class="modal">`) con un formulario de tres campos: Nombre, Correo electrónico y Rol.
- [x] El selector de rol ofrece exactamente las tres etiquetas de `ROL_INFO` y preselecciona «Capturador».
- [x] Un correo vacío o con formato inválido no deja avanzar al paso de confirmación (validación del navegador).
- [x] «Revisar datos» no envía ninguna petición: al pulsarlo aparece el resumen con el nombre, el correo y el rol introducidos.
- [x] «Volver a editar» devuelve al formulario con los valores conservados.
- [x] «Enviar invitación» envía `POST /api/invitations` con `{ nombre, email, rol }` y, con éxito, muestra un aviso de éxito y recarga el listado.
- [x] Con un correo que ya tiene cuenta, el modal muestra el mensaje genérico del servidor y no crea nada.
- [x] Con un error del servidor (por ejemplo, 500), el modal muestra el error y permite volver a editar.
- [x] `POST /api/invitations` responde `400` con un `nombre` de más de 120 caracteres o con un `rol` fuera de la lista blanca.
- [x] `POST /api/invitations` sigue respondiendo `401` sin sesión y `403` con una sesión que no es de `admin`.
- [x] `POST /api/invitations` con `{"email":"…"}` (sin `nombre` ni `rol`) sigue funcionando como antes.
- [x] El usuario creado tiene en `public.usuarios` el `nombre` y el `rol` que se confirmaron en pantalla.
- [x] Si la escritura del perfil falla, no queda ninguna fila en `public.usuarios` con ese correo (borrado compensatorio).
- [x] El correo de invitación saluda por el nombre de la persona.
- [x] A 320 px no hay scroll horizontal en `/dashboard/admin/users` ni con el modal abierto.
- [x] No hay errores de consola en `/dashboard/admin/users` al abrir y usar el modal.
- [x] `README.md` y `AGENTS.md` reflejan la nueva pantalla de alta, el payload ampliado de la API y el árbol final de `src/`.

## Decisiones tomadas y descartadas

- **Sí:** modal con `<dialog>` de HTML y clases de daisyUI 5, en lugar de un div con `modal-open`. Es el patrón que recomienda la librería y da foco atrapado, `ESC` y cierre por clic fuera sin código extra.
- **No:** checkbox `modal-toggle` o el popover API. Son los métodos legados de daisyUI y el popover no mantiene la navegación por teclado dentro del diálogo.
- **Sí:** el modal vive en `src/features/users/components/`, junto al panel que lo usa, y sigue la familia `Users*` (`UsersSearchForm`, `UsersTable`, `UsersPagination`).
- **No:** en `src/features/invitations/components/`. La librería de invitaciones es la del correo (capa de servidor); la pantalla es del área de administración de usuarios.
- **Sí:** un único componente con las tres vistas (formulario, confirmación, resultado) en lugar de tres componentes. Solo hay una vista visible a la vez y comparten el mismo estado; separarlas multiplicaría los props sin ganar nada.
- **Sí:** el paso previo de confirmación es una vista dentro del modal, no una segunda página ni un `alert()` del navegador. `confirm()` bloquearía el hilo y no es accesible.
- **Sí:** el botón de «Revisar datos» no envía nada. La confirmación solo ocurre al pulsar «Enviar invitación».
- **Sí:** el `rol` se guarda con un `UPDATE` del servidor usando la clave secreta, en lugar de leerse de los metadatos de la invitación. Los metadatos los puede escribir quien crea el usuario en Auth; el rol es una decisión de autorización y solo la toma el `admin` que llama a la API.
- **No:** extender `private.handle_new_user()` para leer `rol` de `raw_user_meta_data`. Habría que añadir una migración y abriría la puerta a que un usuario creado por otra vía (un registro público, si el proveedor de correo estuviera abierto) se autoasignara `admin`.
- **Sí:** la lista blanca de roles vive en `src/lib/roles.ts` (`ROL_VALUES`), no en la validación de la API. Una sola fuente de verdad para el servidor y para el formulario.
- **Sí:** `nombre` y `rol` son opcionales en el payload. El `curl` que documenta el README sigue funcionando y no obliga a cambiar a quien ya lo usa.
- **Sí:** si la escritura del perfil falla, se borra el usuario creado. Una cuenta con el rol por defecto y sin correo recibido es un estado que el `admin` no puede arreglar desde la aplicación.
- **Sí:** si el envío del correo falla, se responde `500` y el usuario queda pendiente (comportamiento heredado de SPEC 03). El `admin` puede volver a invitar el mismo correo.
- **No:** reenviar o corregir la invitación desde la aplicación. Es la gestión de invitaciones pendientes, que queda para otro spec.
- **Sí:** tras una invitación correcta, el listado se recarga. La fila la crea el trigger al generarse el enlace, así que la persona aparece ya en la tabla.
- **No:** un indicador de «invitación pendiente» en la tabla. La tabla no tiene ningún dato que distinga a la persona que aún no ha confirmado su correo; ese campo no existe en `public.usuarios` y añadirlo es otro spec.
- **Sí:** el correo saluda por el nombre. Es información que el `admin` ya tiene y hace la invitación más personal.
- **No:** edición de un usuario ya dado de alta (cambiar nombre, correo o rol). Este spec es el alta; la edición es la siguiente pieza del área de administración.

## Riesgos

| Riesgo | Mitigación |
| --- | --- |
| El `UPDATE` de `public.usuarios` no prospera por permisos o RLS | Se usa el cliente con clave secreta, que autoriza como `service_role` (`bypassrls` y `UPDATE` comprobados en la base de datos del proyecto). La operación se verifica con `npx tsc --noEmit`, con `npm run build` y en la prueba real de extremo a extremo. |
| El `UPDATE` falla y queda una cuenta creada con el rol por defecto | Borrado compensatorio con `auth.admin.deleteUser` antes de responder `500`. |
| Se duplica el envío por doble clic | El botón pasa a `btn-loading` y se deshabilita mientras dura la petición. |
| El `admin` confunde «invitado» con «activo» | Se documenta que la fila aparece al generarse el enlace; el indicador de pendiente queda fuera de alcance. |
| El correo falla y la cuenta queda sin enlace | Comportamiento heredado de SPEC 03: se responde `500` y el `admin` puede reintentar con el mismo correo. |
| Un `nombre` con formato inesperado rompe el `UPDATE` | El servidor valida 1–120 caracteres tras `trim`, el mismo límite del `check` de la base de datos. |
| El formulario del modal se usa sin JavaScript | El modal es un diálogo: sin JavaScript no se abre. Es el único punto del panel que depende del cliente, y la búsqueda, el filtro y la paginación siguen funcionando sin él. |

## Qué **no** entra en este spec

- Editar, cambiar de rol, desactivar o eliminar un usuario ya dado de alta.
- Un indicador de «invitación pendiente» o de «confirmó su correo».
- Revocar invitaciones, reenviarlas o gestionarlas en lote.
- Envío de varias invitaciones en una sola operación.
- Recuperación de contraseña y registro público.
- Migraciones en base de datos, cambios en RLS o en las políticas de Supabase Auth.
- Filtro por rol en el listado, ordenación por columnas o exportación a CSV.
- Menú lateral, breadcrumbs o cualquier otro sistema de navegación.
- Cambios en `src/styles/global.css` (temas), en `src/middleware.ts` o en las variables de entorno.

## Verificación

> Ejecutada tras la implementación. La prueba de extremo a extremo se hizo con el correo `jimmyraq@gmail.com` (rol `capturador`): el alta se hizo desde el modal, la persona aparece en `public.usuarios` con el nombre y el rol confirmados y el usuario confirmó que el correo llegó saludando por su nombre.

| Criterio | Estado | Evidencia | Notas |
| --- | --- | --- | --- |
| `npm run build` termina correctamente | ✅ | `Complete!`, solo los avisos `Invalid empty selector` de daisyUI | — |
| `npx tsc --noEmit` no reporta errores | ✅ | salida vacía | — |
| `npm run check` no reporta errores | ✅ | 0 errores, 0 avisos, 0 hints | — |
| El botón «Agregar usuario» aparece para el `admin` | ✅ | Playwright: `button "Agregar usuario"` en el snapshot de `/dashboard/admin/users` | Sesión de `jaime@google.com` (admin) |
| Un no-`admin` recibe 403 y no ve el botón | ✅ | `GET /dashboard/admin/users => 403`; el HTML no contiene `Agregar usuario` ni `users-invite-modal`; muestra «Acceso denegado» | Sesión de `charly@google.com` (supervisor) |
| El modal abre con sus tres campos | ✅ | `<dialog class="modal">` con Nombre, Correo electrónico y Rol | — |
| La validación nativa bloquea los datos incompletos | ✅ | con el formulario vacío, `email.validity.valid === false` y la vista de confirmación sigue oculta; igual con un correo sin formato | Validación HTML5, sin peticiones |
| El resumen de confirmación muestra los tres datos | ✅ | «Marta Prueba» / «marta.prueba@ejemplo.com» / «Supervisor» | — |
| «Revisar datos» no envía ninguna petición | ✅ | 0 peticiones a `/api/` tras pulsar el botón; la primera `/api/invitations` aparece al pulsar «Enviar invitación» | — |
| El alta correcta muestra el aviso de éxito y recarga el listado | ✅ | `alert alert-success` con «Invitación enviada a jimmyraq@gmail.com»; tras «Cerrar y ver el listado» la tabla muestra «Jimmy Raq … Capturador Activo» (4 de 4) | — |
| Un correo duplicado muestra el mensaje genérico | ✅ | `POST /api/invitations => 409`; el modal muestra `alert alert-error` con «No se pudo generar la invitación.» | No se creó nada |
| La API responde 400 con `nombre` largo o `rol` inválido | ✅ | 121 caracteres → «El nombre no puede superar los 120 caracteres.»; `rol: "superadmin"` o `42` → «Rol no válido.»; correo inválido → «Correo electrónico no válido.» | — |
| La API sigue respondiendo 401 y 403 | ✅ | sin sesión → 401 «No autorizado.»; con sesión de supervisor → 403 «Se requiere rol de administrador.» | — |
| El payload antiguo (`{"email":"…"}`) sigue funcionando | ✅ | `200`; la fila queda con `nombre = "payload.antiguo"` (parte local) y `rol = "capturador"` | Persona de prueba borrada después |
| El perfil creado tiene el `nombre` y el `rol` confirmados | ✅ | `public.usuarios`: `nombre = "Jimmy Raq"`, `rol = capturador`; y en la prueba de UI, `nombre = "Ana Prueba UI"`, `rol = admin` | — |
| El borrado compensatorio no deja filas huérfanas | ✅ | forzando un fallo del `UPDATE` (nombre de 200 caracteres, viola el `check`): `500` y **0** filas en `public.usuarios` **y 0** en `auth.users` para ese correo | Log del servidor: `[invitations] no se pudo guardar el perfil:` |
| El correo saluda por el nombre | ✅ | correo recibido en `jimmyraq@gmail.com` con el saludo «Hola, Jimmy Raq, te hemos invitado a crear tu cuenta en Dona de Sangre» (confirmado por el usuario); `sendInviteEmail` genera ese texto y escapa nombre, correo y URL en la parte HTML | — |
| Sin scroll horizontal a 320 px | ✅ | `documentElement.scrollWidth (305) <= innerWidth (320)` con la página y con el modal abierto; la `modal-box` mide 279 px y no tiene scroll propio | — |
| Sin errores de consola | ✅ | 0 errores de JavaScript al abrir y usar el modal; los únicos mensajes son «Failed to load resource» del navegador en las respuestas 4xx/5xx probadas | Inherente al código de estado de la API |
| `README.md` y `AGENTS.md` al día | ✅ | nueva sección «Alta de usuarios desde el panel», estado del proyecto, API, rutas y árbol de `src/` actualizados | — |
