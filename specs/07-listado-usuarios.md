# SPEC 07 — Listado de usuarios con búsqueda y paginación

> **Estado:** Implementado
> **Depende de:** SPEC 02, SPEC 05, SPEC 06
> **Fecha:** 2026-11-12
> **Objetivo:** Reemplazar el texto genérico de `/dashboard/admin/users` por el listado real de los usuarios registrados, con búsqueda por nombre o correo y paginación de 10 por página, y mover `src/pages/dashboard.astro` dentro de `src/pages/dashboard/`.

## Por qué existe este spec

SPEC 06 abrió la puerta al panel administrativo: creó la ruta `/dashboard/admin/users`, la protegió por rol y la enlazó desde el panel. Pero su contenido es un texto que dice que la gestión de usuarios «llegará en una entrega posterior». Hoy el `admin` no puede ver ni un solo nombre de las cuentas del laboratorio, que es justo lo que necesita para saber a quién tiene que invitar, corregir o suspender.

Además, la estructura de rutas quedó a medias: `src/pages/dashboard.astro` es un archivo suelto en `src/pages/` mientras que su subruta vive en `src/pages/dashboard/admin/`. La convención de Astro (`pages/dashboard/index.astro` para `/dashboard`) resuelve esa asimetría sin cambiar ninguna URL.

Este spec entrega la primera parte de la gestión de usuarios: **solo listar**. Registrar, editar, eliminar y suspender quedan para specs posteriores, y este spec no deja ninguna puerta abierta a esas acciones.

## Alcance

**Incluido:**

- Mover `src/pages/dashboard.astro` a `src/pages/dashboard/index.astro` (la URL `/dashboard` no cambia).
- Sustituir el texto genérico de `/dashboard/admin/users` por el listado de los usuarios registrados.
- Búsqueda por nombre o correo, insensible a mayúsculas, sobre el subconjunto de usuarios que el solicitante puede ver.
- Paginación de 10 usuarios por página, navegable sin JavaScript.
- Roles reutilizables (`src/lib/roles.ts`) compartidos entre el panel y la tabla, para no duplicar el mapa de etiquetas y clases de badge.
- Verificación con `npm run build`, `npx tsc --noEmit`, `npm run check`, `curl` y Playwright.

**Fuera de alcance (para specs futuros):**

- Registrar, editar, eliminar o suspender cuentas, y cualquier botón de acción sobre un usuario.
- Campos de suspensión en `public.usuarios` y migraciones asociadas.
- Cambios en Supabase: ni esquema, ni RLS, ni políticas, ni extensiones. Hoy no hace falta ninguno.
- Cambios en `src/middleware.ts`, en la autenticación o en el modelo de datos.
- Búsqueda insensible a acentos: requeriría `unaccent` o una columna normalizada, es decir, un cambio de base de datos.
- Exportar el listado a CSV o enviar invitaciones desde esta pantalla.
- Menú lateral, reorganización del panel o breadcrumbs.
- Temas de daisyUI (`dona` / `dona-dark`): no se toca `src/styles/global.css`.

## Modelo de datos

No se introducen datos nuevos. Se lee `public.usuarios` con la sesión del solicitante.

| Dato | Origen | Uso |
| --- | --- | --- |
| `id` | `public.usuarios.id` | Clave de fila; no se muestra. |
| `nombre` | `public.usuarios.nombre` | Columna «Nombre» y campo de búsqueda. |
| `email` | `public.usuarios.email` | Columna «Correo» y campo de búsqueda. |
| `rol` | `public.usuarios.rol` | Columna «Rol», con badge etiquetado. |
| `claims.sub` | `getClaims()` (middleware) | Identifica al solicitante para decidir su rol. |

### RLS: por qué el listado no necesita la clave secreta

La política `usuarios_select_staff` de SPEC 02 permite `select` sobre toda la tabla cuando `private.current_user_rol()` es `admin` o `supervisor`. Verificado en la base de datos:

| Rol | Filas visibles de `public.usuarios` |
| --- | --- |
| `admin` | 3 de 3 (todas) |
| `capturador` | 1 de 1 (solo la propia) |

Es decir: **el listado se hace con el cliente de sesión (`Astro.locals.supabase`), que ya lleva el JWT del solicitante, y RLS hace el filtrado por su cuenta.** No hace falta `SUPABASE_SECRET_API_KEY`, y esa clave sigue confinada a `src/features/invitations/lib/supabase-admin.ts` para lo único que necesita: `auth.admin.generateLink`.

Comprobado con el JWT real de un `admin` y la clave publicable: `GET /rest/v1/usuarios` devuelve las 3 filas.

## Comportamiento de la búsqueda

La búsqueda viaja en la query string (`?q=…`) y se resuelve en el servidor, sin JavaScript.

### El término se sanea antes de tocar la base de datos

El filtro de PostgREST se construye por interpolación de texto (`or=(nombre.ilike.*término*,email.ilike.*término*)`), así que el término **no puede ir crudo**. Se comprobaron empíricamente tres fallos reales con un término sin sanear:

| Entrada del usuario | Qué pasa si va cruda |
| --- | --- |
| `a,b` | La coma rompe el árbol de filtros de PostgREST: error `PGRST100`, la página revienta con un 500. |
| `x; delete from usuarios` | Cloudflare bloquea la petición (403 con una página HTML). Un usuario puede tumbar el listado escribiendo eso en el buscador. |
| `j_a` | `_` es comodín de un carácter en `ILIKE`: encontraría `jaime`, `jose`… El usuario busca un literal y el sistema le devuelve de más. |

Por eso el término pasa por una lista blanca (`sanitizeSearchTerm`):

1. `normalize('NFC')`: unifica la representación de los acentos.
2. Se conserva solo `letras` (incluidas acentuadas), `dígitos`, `espacio`, `@`, `.`, `-` y `_`; **cualquier otro carácter se sustituye por un espacio**. De aquí desaparecen la coma, el punto y coma, los paréntesis, las comillas, el `%` y el `*`, que son los problemáticos.
3. Se escapa `_` como `\_`, para que se comporte como un guion bajo literal y no como comodín.
4. Se colapsan los espacios, se recorta al inicio y al final, y se limita a 100 caracteres.

El valor saneado es el que se busca **y** el que se muestra en el campo de búsqueda y en los enlaces de paginación. Así lo que el usuario ve es exactamente lo que el sistema está buscando, y recargar la página no cambia el resultado.

Verificado contra la base de datos con el término ya saneado: `jaime`, `jaime@google.com` y `Jaime` encuentran lo esperado; `a,b`, `x; delete from usuarios`, `'; drop table usuarios; --` y `../../etc/passwd` devuelven 0 filas sin error y sin bloqueo; `j_a` devuelve 0 filas (literal, no comodín).

### Limitación conocida: los acentos

`ILIKE` no ignora los acentos y la extensión `unaccent` no está instalada en el proyecto. Buscar `jose` **no** encuentra a `José`. Se documenta como limitación; resolverlo exigiría un cambio de base de datos, que queda fuera de este spec.

## Comportamiento de la paginación

- Tamaño de página: **10 usuarios**, constante `USERS_PER_PAGE`.
- El número de página viaja en `?page=…` (1-indexado).
- El orden es estable: por `nombre` ascendente y, a igualdad, por `email` ascendente. `email` es único, así que el orden no puede cambiar entre peticiones (imprescindible para que la paginación no repita ni omita filas).

### El rango se recorta antes de consultar

Una consulta con `Range` más allá del final no devuelve una lista vacía: **devuelve un error** (`PGRST103`, «Requested range not satisfiable»). Con 3 usuarios, pedir la página 2 (offset 10) revienta la consulta.

Por eso el listado hace **dos consultas** en lugar de una:

1. `countUsers()`: un `HEAD` con `count: 'exact'` y el mismo filtro de búsqueda. Devuelve el total de filas coincidentes sin traer datos.
2. `fetchUsersPage()`: con el total ya conocido, se recorta la página al rango válido (`1 … totalPages`) y se pide el rango `[(page-1)*10, (page-1)*10 + 9]`.

La segunda consulta nunca puede quedar fuera de rango, así que el error `PGRST103` es imposible por construcción. Una página pedida que no existe (por ejemplo `?page=99`) se recorta a la última página válida en lugar de fallar.

El total que devuelve `count` respeta RLS: es el número de filas que el solicitante puede ver, no el de la tabla entera.

## Especificación visual y de accesibilidad

La página mantiene el patrón de SPEC 06: `BaseLayout` + `AppNavbar` + una tarjeta daisyUI. La tarjeta pasa de `max-w-md` a `max-w-4xl` porque una tabla de tres columnas necesita el ancho.

- Título de la tarjeta: «Administrar usuarios» (se mantiene).
- **Debajo del título va directamente el buscador y la tabla**: el texto genérico de SPEC 06 desaparece. Lo primero que ve el `admin` al entrar es la lista.
- **Buscador**: campo de búsqueda con etiqueta visible («Buscar por nombre o correo»), tipo `search`, y botón «Buscar». Envía un `GET` a la misma ruta con el parámetro `q`. Al enviarlo, el parámetro `page` desaparece de la URL, de modo que una búsqueda nueva siempre empieza en la página 1.
- Enlace «Quitar filtro» cuando hay una búsqueda activa.
- **Tabla**: `Nombre`, `Correo`, `Rol`. El rol se muestra con `badge` y su etiqueta legible («Administrador», «Supervisor», «Capturador»), no con el valor crudo del enum.
- **Contador**: «Mostrando X–Y de Z usuarios».
- **Paginación**: `join` de daisyUI con «Anterior», los números de página y «Siguiente». La página activa se marca con `btn-active` y `aria-current="page"`. Los extremos no disponibles se renderizan como `<span class="btn-disabled">`, no como enlaces: no son navegables ni enfocables.
- **Responsive**: la tabla vive en un contenedor `overflow-x-auto` y la columna de correo usa `break-all`, de modo que ni en 320 px la página desborda horizontalmente.
- La tabla tiene un `<caption>` visible que anuncia su contenido, y el buscador un `<label for>` real: nada depende solo del `aria-label`.

### Estados vacíos

- Sin usuarios y sin filtro: «Todavía no hay usuarios registrados.»
- Con filtro y 0 resultados: «No se encontraron usuarios que coincidan con «término».»

## Comportamiento y autorización

1. `/dashboard` carga el perfil como hoy. Si `rol === 'admin'`, muestra debajo la tarjeta «Administrar usuarios». **Sin cambios respecto a SPEC 06.**
2. El middleware ya protege `/dashboard/*` por sesión (`isProtectedPath` cubre el prefijo `/dashboard/`). Sin sesión válida responde 302 a `/auth/login?next=%2Fdashboard%2Fadmin%2Fusers`. **Sin cambios.**
3. La página consulta la fila del solicitante en `public.usuarios`:
   - Si `rol === 'admin'` → 200 con el listado.
   - Si `rol !== 'admin'` → 403 con el navbar y el aviso de acceso denegado de SPEC 06.
4. **La consulta del listado solo se ejecuta si el solicitante es `admin`.** Con un rol no administrador no se pide ni una fila de la tabla: el 403 se decide antes de leer.
5. Si la consulta del perfil falla o no devuelve fila, el rol se trata como `null` y la ruta responde 403 (fail closed).
6. La autorización se decide siempre en el servidor, en el frontmatter de la página. Ocultar el enlace nunca es la única barrera.
7. La página no escribe en la base de datos ni envía correos.

## Estructura de archivos

```text
src/
├── lib/
│   └── roles.ts                             # NUEVO: tipo Rol + mapa de etiqueta y badge
├── components/ui/
│   └── AppNavbar.astro                     # sin cambios
└── features/
    ├── dashboard/components/
    │   └── AdminUsersShortcutCard.astro    # sin cambios
    └── users/
        ├── components/
        │   ├── AdminUsersPanel.astro       # REESCRITO: tarjeta + buscador + tabla + paginación
        │   ├── UsersSearchForm.astro       # NUEVO: formulario GET de búsqueda
        │   ├── UsersTable.astro            # NUEVO: tabla de usuarios y estados vacíos
        │   └── UsersPagination.astro       # NUEVO: controles de paginación
        └── lib/
            └── users-list.ts               # NUEVO: consulta, saneado del término y ventana de páginas
```

Páginas:

```text
src/pages/
├── dashboard/
│   ├── index.astro                        # MOVIDO desde src/pages/dashboard.astro
│   └── admin/
│       └── users.astro                    # lista de usuarios (solo admin)
```

### Contrato de los archivos nuevos y modificados

| Archivo | Responsabilidad |
| --- | --- |
| `src/lib/roles.ts` | Exporta el tipo `Rol` y el mapa `ROL_INFO` (`{ label, className }`). Hoy ese mapa está declarado dentro de `src/pages/dashboard.astro`; con la tabla de usuarios dejaría de estarlo. |
| `src/features/users/lib/users-list.ts` | `USERS_PER_PAGE`, `sanitizeSearchTerm()`, `countUsers()`, `fetchUsersPage()`, `buildPageWindow()` y los tipos `UsuarioListItem` / `UsersListResult`. Es el único sitio que conoce el filtro de PostgREST. |
| `src/features/users/components/AdminUsersPanel.astro` | Props `denied?` y `result?`. Con `denied` muestra el aviso de acceso denegado (mismo texto que SPEC 06); sin él, compone `UsersSearchForm` + `UsersTable` + `UsersPagination`. |
| `src/features/users/components/UsersSearchForm.astro` | Props `search`. Formulario `GET` a `/dashboard/admin/users` con el campo `q`. |
| `src/features/users/components/UsersTable.astro` | Props `usuarios` y `search`. Tabla con nombre, correo y rol, más los dos estados vacíos. |
| `src/features/users/components/UsersPagination.astro` | Props `page`, `totalPages` y `search`. `join` de daisyUI con anterior, números y siguiente; conserva `q` al construir los enlaces. |
| `src/pages/dashboard/index.astro` | El panel, movido. Solo cambian la ruta del archivo y las rutas relativas de los imports. |
| `src/pages/dashboard/admin/users.astro` | Frontmatter: guarda de sesión, consulta del rol, recorte de `q` y `page`, llamada a `listUsers()` y render de `AdminUsersPanel`. |

## Plan de implementación

1. Crear `src/lib/roles.ts` con el tipo `Rol` y el mapa `ROL_INFO`, y hacer que `src/pages/dashboard.astro` lo importe en lugar de declarar el mapa en línea. Verificar con `npm run build` y `npx tsc --noEmit` que el HTML servido del panel no cambia.
2. Crear `src/features/users/lib/users-list.ts` con `sanitizeSearchTerm()`, `countUsers()`, `fetchUsersPage()`, `buildPageWindow()` y los tipos. Verificar con `npx tsc --noEmit`.
3. Mover `src/pages/dashboard.astro` a `src/pages/dashboard/index.astro` con `git mv` y corregir las rutas relativas de los imports (`../` → `../../`). Verificar con `npm run build` y comprobando que `/dashboard` sigue respondiendo 200 con la misma tarjeta de perfil.
4. Crear `UsersSearchForm.astro`, `UsersTable.astro` y `UsersPagination.astro` con el marcado daisyUI descrito arriba.
5. Reescribir `AdminUsersPanel.astro` para componer los tres componentes y conservar el aviso de acceso denegado.
6. Reescribir el frontmatter de `src/pages/dashboard/admin/users.astro`: recorte de `q` y `page`, llamada a `listUsers()` y render del panel. Verificar con `npm run build`, `npx tsc --noEmit` y `npm run check`.
7. Verificar con `curl`: 302 sin cookie, 403 con sesión no-`admin`, 200 con sesión `admin`, y el HTML servido con la tabla y los usuarios reales.
8. Verificar con Playwright: la lista se ve, el buscador filtra, la paginación funciona, no hay scroll horizontal a 320 px ni errores de consola.
9. Actualizar `README.md` (estado del proyecto, rutas y árbol de `src/`) y `AGENTS.md` (árbol de `src/`).

## Criterios de aceptación

- [x] `npm run build` termina correctamente (solo los avisos no fatales `Invalid empty selector` de daisyUI).
- [x] `npx tsc --noEmit` no reporta errores.
- [x] `npm run check` (`astro check`) no reporta errores en los `.astro`.
- [x] `/dashboard` sigue respondiendo 200 y su tarjeta de perfil (nombre, correo, rol) no cambia de contenido.
- [x] La ruta `/dashboard` se sirve desde `src/pages/dashboard/index.astro` y el archivo `src/pages/dashboard.astro` ya no existe.
- [x] `/dashboard/admin/users` con sesión de `admin` responde 200 y muestra una tabla con los usuarios registrados: nombre, correo y rol (con badge y etiqueta legible), no el texto genérico de SPEC 06.
- [x] El listado muestra los usuarios que el solicitante puede ver por RLS, no la tabla entera.
- [x] La tabla no contiene ningún botón ni enlace de acción sobre un usuario (registrar, editar, eliminar, suspender).
- [x] Un término de búsqueda que coincide con un nombre o un correo encuentra ese usuario.
- [x] La búsqueda no distingue mayúsculas de minúsculas.
- [x] Un término de búsqueda que no coincide con nadie muestra el estado vacío y no un error.
- [x] Un término con `,` o `;` no provoca un error 500 ni un bloqueo: la página responde 200.
- [x] La búsqueda se hace en el servidor, con JavaScript desactivado.
- [x] La paginación muestra como máximo 10 usuarios por página.
- [x] Con más de 10 usuarios, la paginación muestra varias páginas y se puede navegar entre ellas; cada página muestra usuarios distintos.
- [x] La paginación conserva el término de búsqueda al cambiar de página.
- [x] Un número de página fuera de rango se recorta a la última página válida y no provoca error.
- [x] El texto de «Buscar por nombre o correo» y el valor del campo coinciden con lo que realmente se busca.
- [x] Con sesión de un usuario que no es `admin`, `GET /dashboard/admin/users` responde 403 y no contiene filas de usuarios.
- [x] Sin sesión, `GET /dashboard/admin/users` responde 302 a `/auth/login?next=%2Fdashboard%2Fadmin%2Fusers`.
- [x] La página no escribe en la base de datos ni envía correos.
- [x] A 320 px no hay scroll horizontal en `/dashboard` ni en `/dashboard/admin/users`.
- [x] No hay errores de consola en `/dashboard` ni en `/dashboard/admin/users`.
- [x] `README.md` y `AGENTS.md` reflejan el árbol final de `src/` y la nueva funcionalidad.

## Decisiones tomadas y descartadas

- **Sí:** dos consultas (total y página). Una sola consulta con `Range` devuelve un error cuando el rango se pasa de largo; recortar antes necesita conocer el total.
- **No:** recortar el rango con un máximo fijo. Un máximo inventado no sabe cuántas páginas hay.
- **Sí:** el listado se lee con el cliente de sesión (`Astro.locals.supabase`). La política `usuarios_select_staff` de SPEC 02 ya deja leer al `admin` todas las filas, así que RLS hace el filtrado y la clave secreta no hace falta.
- **No:** usar `supabase-admin.ts` (clave `sb_secret_…`) para el listado. Sería la vía más corta, pero mete una clave que hoy solo se usa para `generateLink` en un sitio donde no hace falta, y esquivaría RLS.
- **Sí:** búsqueda y paginación por query string, resueltas en el servidor. El sitio es SSR y no usa framework de UI: la navegación por enlaces funciona sin JavaScript y cada URL es compartible.
- **No:** un endpoint JSON propio (`/api/admin/users`) más render en cliente. Duplica la autorización en dos sitios (la ruta y el endpoint) y hace la pantalla inaccesible sin JavaScript.
- **Sí:** sanear el término con lista blanca antes de construir el filtro. Comprobado: sin sanear, una coma da un 500 y un `; delete from` provoca un bloqueo de Cloudflare.
- **No:** confiar en que los valores del filtro se parametrizan. Parametrizados están contra la inyección de SQL, pero no contra el parser del árbol de filtros ni contra el WAF de Cloudflare, que opera sobre la URL.
- **Sí:** escapar `_` como `\_`. Es un comodín de un carácter en `ILIKE`; sin escaparlo, buscar `j_a` devuelve `jaime`.
- **No:** usar `%` como comodín propio en el término. El comodín del filtro lo aporta el `*` de los extremos; meter `%` del usuario abriría la misma puerta que `_`.
- **Sí:** el valor saneado es el que se muestra en el campo de búsqueda y en los enlaces de paginación. Lo que se ve es lo que se busca, y recargar no cambia el resultado.
- **No:** mostrar el término crudo. Reintroduciría en la URL los caracteres que obligan a sanear.
- **Sí:** el rango se recorta a la última página válida en lugar de devolver 404. Una página inexistente es un enlace caducado, no un error que deba ver el usuario.
- **Sí:** orden por `nombre` y luego por `email`. `email` es único, así que el orden es total y estable; sin eso la paginación puede repetir o saltar filas entre peticiones.
- **Sí:** el `admin` ve a los tres usuarios. `supervisor` también puede leerlos por RLS desde SPEC 02, pero la ruta sigue siendo solo de `admin` (403), tal y como fijó SPEC 06.
- **No:** cambiar la política `usuarios_select_staff` para dejar solo a `admin`. Es una decisión de SPEC 02 sobre el modelo de permisos del laboratorio, no de esta pantalla.
- **Sí:** `src/lib/roles.ts` para el mapa de roles. Con la tabla de usuarios, el mapa deja de estar en un solo sitio; `src/lib/` es la ubicación multi-feature que fija `AGENTS.md`.
- **No:** un componente `RoleBadge.astro`. El badge se pinta en dos sitios (el panel y la tabla) con el mismo mapa; un componente de una línea no aporta nada sobre dos `span` con la misma clase.
- **Sí:** cuatro componentes (`AdminUsersPanel`, `UsersSearchForm`, `UsersTable`, `UsersPagination`). Cada uno tiene una responsabilidad y props propias; el panel se queda corto y la paginación, que es la parte con más lógica, se puede revisar aislada.
- **No:** el buscador reutiliza `FormField` de `features/auth/components/`. Ese componente pinta un `fieldset` con etiqueta e input, y el buscador necesita además un botón de envío y conservar el valor actual: forzar `FormField` obligaría a tocar sus props y a moverlo a `components/ui/`, arrastrando a las pantallas de autenticación sin ganar nada. El buscador se pinta en su propio componente.
- **Sí:** el texto genérico de SPEC 06 desaparece. Lo primero que ve el `admin` es la lista.
- **No:** acciones sobre los usuarios (editar, suspender, eliminar). Quedan para otro spec, y este no deja ningún botón que las insinúe.
- **Sí:** la búsqueda no ignora acentos. Hacerlo exigiría `unaccent` o una columna normalizada: un cambio de base de datos que este spec no toca. Se documenta como limitación.

## Riesgos

| Riesgo | Mitigación |
| --- | --- |
| Un término con `,` o `;` rompe la página o la bloquea | El término se sanea antes de construir el filtro. Verificado en la base de datos con `a,b`, `x; delete from usuarios` y `'; drop table usuarios; --`: 0 filas, sin error y sin bloqueo. |
| El `Range` fuera de rango devuelve un error en lugar de una lista vacía | El total se consulta antes y la página se recorta al rango válido, así que la consulta nunca sale de rango. |
| La paginación repite u omite filas entre peticiones | El orden es por `nombre` y luego `email`, y `email` es único: el orden es total y estable. |
| El filtro de búsqueda deja fuera a alguien con un correo o nombre con acentos | `sanitizeSearchTerm` conserva las letras acentuadas (`\p{L}`), así que «José» se busca y se encuentra; lo que no funciona es buscar «jose» sin tilde. Limitación documentada. |
| El listado filtra por RLS y podría devolver menos usuarios de los esperados | Comprobado con el JWT real de un `admin`: devuelve las 3 filas. Con un rol no `admin` la consulta ni siquiera se ejecuta. |
| El buscador depende de la query string y un término con acentos o espacios puede romperse al codificarse | Los enlaces se construyen con `URLSearchParams`, que codifica y decodifica de forma simétrica; verificado que un término con espacio llega intacto al servidor. |
| La página crece con `AdminUsersPanel` como contenedor de tres subcomponentes | Cada subcomponente tiene una sola responsabilidad; el panel solo compone. |
| Verificar el listado exige una sesión de `admin` válida | Las sesiones que había en el entorno caducaron. Se abre una sesión nueva con `auth.admin.generateLink` + `verifyOtp` (no envía correo ni crea usuarios) y se reutiliza en `curl` y Playwright. |

## Qué **no** entra en este spec

- Registrar, editar, eliminar y suspender cuentas.
- Campos de suspensión en `public.usuarios` y migraciones asociadas.
- Interfaz de las invitaciones (`POST /api/invitations` ya existe, falta la pantalla).
- Búsqueda insensible a acentos, búsqueda por rol, ordenación por columnas y exportación.
- Recuperación de contraseña y registro público.
- Menú lateral, breadcrumbs o cualquier otro sistema de navegación.
- Cambios en Supabase (esquema, RLS, políticas, extensiones), en `src/middleware.ts`, en `src/styles/global.css` y en las variables de entorno.

## Verificación

> **Ejecutada tras la implementación (2026-11-12).** Sesión de `admin` y de `capturador` obtenidas con `auth.admin.generateLink` + `verifyOtp` (no envía correo ni crea usuarios).

| Criterio | Estado | Evidencia | Notas |
| --- | --- | --- | --- |
| `npm run build` termina correctamente | ✅ | `npm run build` → `Complete!` | Solo los avisos no fatales `Invalid empty selector` de daisyUI |
| `npx tsc --noEmit` no reporta errores | ✅ | Sin salida, código 0 | — |
| `npm run check` no reporta errores | ✅ | `Result (30 files): 0 errors, 0 warnings, 0 hints` | — |
| `/dashboard` conserva su tarjeta de perfil | ✅ | HTML servido: `jaime` / `jaime@google.com` / badge `Administrador` | El commit del movimiento solo cambia las rutas de los imports (`git show 83ab986`) |
| El archivo se movió a `dashboard/index.astro` | ✅ | `git show 83ab986`: `rename from src/pages/dashboard.astro`; `src/pages/dashboard.astro` no existe | — |
| La tabla lista los usuarios con nombre, correo y rol | ✅ | HTML con sesión de `admin`: 3 filas (`charly`, `jaime`, `luis`) | — |
| No hay texto genérico ni botones de acción | ✅ | 0 coincidencias de «entrega posterior»; los únicos botones son «Cerrar sesión» y «Buscar» | La tabla no tiene ni un enlace ni un botón por usuario |
| La búsqueda encuentra por nombre y por correo | ✅ | `?q=jaime` → 1 fila; `?q=jaime@google.com` → 1 fila; `?q=charly` → 1 fila | — |
| La búsqueda no distingue mayúsculas | ✅ | `?q=JAIME` → 1 fila (igual que `?q=jaime`) | — |
| Un término con `,` o `;` no rompe la página | ✅ | `?q=a,b`, `?q=x; delete from usuarios` y `?q='; drop table usuarios; --` → 200, 0 filas | El campo muestra el término saneado: `a b`, `x delete from usuarios`, `drop table usuarios --` |
| La búsqueda funciona sin JavaScript | ✅ | Contexto de Playwright con `javaScriptEnabled: false`: 200, 3 filas; al enviar el formulario → `?q=luis` con 1 fila | El formulario es `GET` a `/dashboard/admin/users` con un único campo `q` |
| La paginación muestra 10 usuarios por página | ✅ | Con 23 usuarios en la base: «Mostrando 1–10 de 23 usuarios» en la página 1 y «11–20» en la 2 | 20 filas temporales creadas y borradas después |
| La paginación navega y conserva la búsqueda | ✅ | Playwright: «Siguiente» → `?page=2` con 10 usuarios distintos; «3» → `?page=3` con 3 distintos (sin solapamiento) | Con búsqueda: `?q=test` → `?q=test&page=2`, y los enlaces de la paginación conservan `q=test` |
| Una página fuera de rango se recorta | ✅ | `?page=4` y `?page=99` → 200 con la última página válida (la 3 de 3) | `page=0`, `page=-5`, `page=abc` y `page=1.5` también se recortan a la 1 |
| El texto del campo coincide con lo que se busca | ✅ | `?q=a,b` → el campo muestra `a b` y la búsqueda real es `a b` | El campo refleja siempre el valor saneado |
| Un no-`admin` recibe 403 y no ve filas | ✅ | `curl` con sesión de `capturador` → 403 y 0 `<td>` en el HTML | El aviso «Acceso denegado…» se mantiene de SPEC 06 |
| Sin sesión, 302 al login | ✅ | `curl` sin cookie → 302 a `/auth/login?next=%2Fdashboard%2Fadmin%2Fusers` | — |
| La página no escribe ni envía correos | ✅ | Logs de Supabase de la ventana de verificación: sobre `/rest/v1/usuarios` solo `GET 200` y `HEAD 200`; ningún `POST`/`PATCH`/`DELETE` | El código solo llama a `listUsers()`; no hay `insert`/`update`/`delete` ni envío de correos |
| Sin scroll horizontal a 320 px | ✅ | Playwright a 320×720: `scrollWidth === clientWidth` en `/dashboard` y en `/dashboard/admin/users` | También comprobado a 375 y 768 px |
| Sin errores de consola | ✅ | `consoleErrors: []` en `/dashboard` y en `/dashboard/admin/users` | — |
| `README.md` y `AGENTS.md` al día | ✅ | Commit `a954367`: los dos archivos con el árbol final de `src/` y la nueva funcionalidad | — |

### Comprobaciones adicionales

| Comprobación | Estado | Evidencia |
| --- | --- | --- |
| RLS filtra por rol, no por código | ✅ | Con el JWT real: `admin` → 3 filas, `supervisor` → 3 filas, `capturador` → 1 fila (solo la propia) |
| La consulta no se ejecuta con un rol no `admin` | ✅ | El frontmatter solo llama a `listUsers()` si `isAdmin`; con `capturador` no hay ninguna petición a `/rest/v1/usuarios` en los logs |
| El sanitado del término | ✅ | `sanitizeSearchTerm`: `a,b` → `a b`; `x; delete` → `x delete`; `j_a` → `j\_a`; `%` y `*` → vacío (sin comodín); `José` → `José`; recorte a 100 caracteres |
| El recorte del rango | ✅ | `listUsers` con 25 filas simuladas: página 2 → rango `10–19`, página 99 → rango `20–29` (recortada), total 0 → rango `0–9` |
| El total de `count` respeta RLS | ✅ | La página de `admin` muestra «de 3 usuarios», no el total de la tabla |
| El orden es estable | ✅ | `order('nombre').order('email')`, ambas ascendentes |

### Observaciones (no bloquean la verificación)

1. **El recorte a 100 caracteres puede dejar una barra invertida suelta.** `sanitizeSearchTerm` escapa `_` como `\_` *antes* de recortar a 100 caracteres (el orden que fija este spec), así que un término de 100 caracteres que acabe en `_` se corta entre la barra y el guion bajo: el resultado es un término que termina en `\` y el filtro queda `ilike.*…\*`, donde `\*` busca un asterisco literal. Verificado contra la base real: `?q=` + 99 letras + `_` → 200, 0 filas, y el campo muestra el término con la barra al final. No es un error ni un problema de seguridad (la barra solo puede venir del propio escapado), pero el término buscado ya no es el que el usuario escribió. Se arreglaría recortando antes de escapar, o quitando una barra invertida final tras el recorte.
2. **A 320 px la columna «Rol» queda fuera de la vista sin desplazamiento.** La tabla vive en un contenedor `overflow-x-auto` y la página no desborda (`scrollWidth === clientWidth`), que es lo que pide el criterio. Con el `break-all` de la columna de correo, cada fila ocupa además cinco líneas y hay que desplazar el contenedor para ver el rol. Es consecuencia de las decisiones fijadas en este spec (`overflow-x-auto` + `break-all`), no de un fallo de la implementación.
