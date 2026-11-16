# SPEC 11 — Sección «Registrar donación» en el panel (solo visual)

> **Estado:** Aprobado
> **Depende de:** SPEC 01, SPEC 02, SPEC 05, SPEC 06
> **Fecha:** 2026-11-15
> **Objetivo:** Abrir el acceso al registro de donaciones desde el panel: una tarjeta en `/dashboard` que navega a la página nueva `/dashboard/donaciones/nueva`, y esa página con el navbar del panel y un marcador que anuncia el formulario que llegará después. Esta entrega es **solo la parte visual**: no hay campos, ni validaciones, ni escritura en base de datos.

## Por qué existe este spec

El panel hoy solo tiene dos destinos: el perfil propio (`/dashboard`) y, para un `admin`, la administración de usuarios (`/dashboard/admin/users`). La razón de ser del proyecto —el registro de donaciones de sangre— no tiene ninguna entrada en la interfaz.

Este spec fija el punto de entrada y el esqueleto de la pantalla destino: la tarjeta, la ruta, el navbar y el marcador. El formulario real (campos, validaciones y persistencia) es una entrega posterior, y este spec **no** lo anticipa para no diseñar dos veces lo mismo: primero se acuerda dónde vive la pantalla y cómo se llega a ella.

Se elige la ruta anidada `/dashboard/donaciones/nueva` para dejar sitio, sin reestructurar nada, a un futuro listado en `/dashboard/donaciones` y a una edición en `/dashboard/donaciones/[id]`.

## Alcance

**Incluido:**

- Tarjeta «Registrar donación» en el cuerpo de `/dashboard`, visible para cualquier sesión activa (todos los roles).
- Nueva página `/dashboard/donaciones/nueva` (`src/pages/dashboard/donaciones/nueva.astro`).
- La página reutiliza el navbar del panel y muestra una tarjeta con un marcador que anuncia el formulario futuro.
- Enlace de vuelta al panel desde la página nueva.
- Nueva feature `src/features/donations/` con el componente de la página.
- Actualización de `README.md` y `AGENTS.md`.
- Verificación con `npm run build`, `npx tsc --noEmit`, `npm run check` y Playwright.

**Fuera de alcance (para specs futuros):**

- Los campos del formulario, sus validaciones y sus mensajes.
- Persistencia: tablas `donaciones` / `donantes`, migraciones, RLS y tipos generados.
- Endpoints de API nuevos o ampliados.
- Listado, edición o borrado de donaciones.
- Guardas por rol distintas de la sesión: hoy la tarjeta es para todos los roles y la página no comprueba rol.
- Menú lateral, breadcrumbs o cualquier otro sistema de navegación.
- Cambios en `src/middleware.ts`, en `src/styles/global.css`, en `astro.config.mjs` o en las variables de entorno.

## Modelo de datos

**No hay cambios en el esquema y no se lee ningún dato.** Las dos pantallas son estáticas:

| Dato | Origen | Uso |
| --- | --- | --- |
| `claims` | `Astro.locals.claims` (middleware, SPEC 02) | Solo para decidir el redirect a login si falta la sesión |
| `rol` | `Astro.locals.currentUser.rol` | **No se usa**: la tarjeta y la ruta son para todos los roles activos |

No se crean tablas, columnas, políticas ni triggers. No se consulta `public.usuarios` para esta pantalla: el middleware ya resolvió la sesión y bloqueó las cuentas `inactivo` antes de llegar a la página.

## Especificación visual y de accesibilidad

### La tarjeta del panel

- Patrón daisyUI `card` > `card-body` > `card-title` + `card-actions`, en línea con la tarjeta de perfil y con `AdminUsersShortcutCard`.
- Clases: `card w-full max-w-md bg-base-100 shadow-xl`, `card-body gap-4`, `card-title text-xl`.
- Título: «Registrar donación». Descripción: «Captura los datos de la persona donante y su donación».
- La acción es un enlace, no un botón: `<a href="/dashboard/donaciones/nueva" class="btn btn-primary btn-sm">Registrar donación</a>`. Es una navegación, no el envío de un formulario.
- El enlace lleva texto explícito (no un icono suelto) para que su destino se entienda fuera de contexto.
- Se renderiza siempre que haya sesión, sin condición de rol: la rama no autorizada no existe en esta pantalla.

### La página nueva

- Mantiene el navbar del panel (`AppNavbar`) y el mismo contenedor `main` (`flex flex-1 flex-col items-center justify-start gap-4 p-4 sm:justify-center sm:p-6`).
- Tarjeta `card w-full max-w-md bg-base-100 shadow-xl` con:
  - `card-title` «Registrar donación».
  - Un marcador (`alert` o texto con `text-base-content/60`) que anuncia que el formulario llegará en una entrega posterior. El marcador es explícito: quien abra la pantalla no debe pensar que la aplicación está rota.
  - `card-actions` con un enlace «Volver al panel» (`btn btn-ghost btn-sm`) a `/dashboard`.
- Ningún `<form>`, ningún `<input>`, ningún `<script>`.
- Responsive: `max-w-md` más `wrap-break-word` en el texto, sin scroll horizontal a 320 px.

## Comportamiento

1. `/dashboard` carga como hoy. Bajo la tarjeta «Tu perfil» aparece la tarjeta «Registrar donación», para todos los roles activos. Un `admin` ve además «Administrar usuarios» (SPEC 06), que no cambia.
2. Al pulsar el enlace se pide `/dashboard/donaciones/nueva`; la sesión viaja en la cookie `httpOnly`.
3. El middleware ya protege `/dashboard/*` por sesión (`isProtectedPath` cubre el prefijo `/dashboard/`): sin sesión válida responde 302 a `/auth/login?next=%2Fdashboard%2Fdonaciones%2Fnueva`; con una cuenta `inactivo` aplica el bloqueo de SPEC 08 (302 a `/cuenta-desactivada`).
4. La página no comprueba rol y no consulta la base de datos: solo renderiza el navbar y la tarjeta con el marcador.
5. La página no acepta parámetros, no escribe y no envía correos. No hay peticiones a `/api/*` al cargarla.
6. «Volver al panel» navega a `/dashboard`.

## Estructura de archivos

```text
src/
├── features/
│   ├── dashboard/
│   │   └── components/
│   │       ├── AdminUsersShortcutCard.astro      # sin cambios
│   │       └── NewDonationShortcutCard.astro     # NUEVO: tarjeta con el enlace
│   └── donations/
│       └── components/
│           └── NewDonationPanel.astro            # NUEVO: tarjeta de la página destino + marcador
└── pages/
    └── dashboard/
        ├── index.astro                           # MODIFICADO: añade la tarjeta nueva
        └── donaciones/
            └── nueva.astro                       # NUEVO: ruta de la pantalla
```

### Contrato de los archivos nuevos y modificados

| Archivo | Responsabilidad |
| --- | --- |
| `src/features/dashboard/components/NewDonationShortcutCard.astro` | La tarjeta del panel con el enlace a `/dashboard/donaciones/nueva`. Sin props: el contenido es fijo. |
| `src/features/donations/components/NewDonationPanel.astro` | La tarjeta de la página destino: título, marcador del formulario futuro y enlace de vuelta al panel. Sin props. |
| `src/pages/dashboard/donaciones/nueva.astro` | Frontmatter con el redirect a login si falta `claims`; renderiza `BaseLayout` + `AppNavbar` + `NewDonationPanel`. |
| `src/pages/dashboard/index.astro` | Renderiza `NewDonationShortcutCard` junto a la tarjeta de perfil. |

### Por qué la tarjeta vive en `features/dashboard/`

Es el mismo caso que `AdminUsersShortcutCard.astro` (SPEC 06): una tarjeta de entrada del panel, no una pantalla de la feature. Se mantiene la familia y la ubicación ya existentes para no partir el criterio. La feature `donations` nace con la pantalla destino (`NewDonationPanel`), que es donde crecerá el formulario; los helpers de su capa de datos, cuando existan, irán a `src/features/donations/lib/`.

### Por qué no hay guarda de rol

El formulario de captura es trabajo de cualquier persona del laboratorio, no una tarea administrativa: los tres roles (`admin`, `supervisor`, `capturador`) lo ven y entran. Añadir un `403` aquí sería inventar una restricción que el negocio no pidió; cuando el formulario exista y se decida quién puede usarlo, la comprobación se hará en el frontmatter de la página, como en `/dashboard/admin/users`, nunca solo ocultando el enlace.

## Plan de implementación

1. Crear `src/features/dashboard/components/NewDonationShortcutCard.astro` con la tarjeta y el enlace. Verificar con `npm run build` y `npm run check`.
2. Crear `src/features/donations/components/NewDonationPanel.astro` con el título, el marcador y el enlace de vuelta. Verificar con `npm run build` y `npm run check`.
3. Crear `src/pages/dashboard/donaciones/nueva.astro` con el redirect a login y el `BaseLayout` + `AppNavbar` + `NewDonationPanel`. Verificar con `npm run build`, `npx tsc --noEmit` y `npm run check`.
4. Añadir `NewDonationShortcutCard` a `src/pages/dashboard/index.astro` bajo la tarjeta de perfil. Verificar con `npm run build` y `npm run check`.
5. Verificar con Playwright: la tarjeta aparece para un rol no `admin`, el enlace navega a la ruta nueva, la página muestra el navbar y el marcador, «Volver al panel» regresa, sin scroll horizontal a 320 px y sin errores de consola.
6. Comprobar con `curl -i` que sin sesión la ruta responde 302 a `/auth/login?next=%2Fdashboard%2Fdonaciones%2Fnueva`.
7. Actualizar `README.md` (rutas y estructura) y `AGENTS.md` (árbol de `src/`, lista de specs 01–11).

## Criterios de aceptación

- [ ] `npm run build` termina correctamente (solo los avisos no fatales `Invalid empty selector` de daisyUI).
- [ ] `npx tsc --noEmit` no reporta errores.
- [ ] `npm run check` (`astro check`) no reporta errores en los `.astro`.
- [ ] Con una sesión activa de cualquier rol, `/dashboard` muestra la tarjeta «Registrar donación».
- [ ] La tarjeta de perfil y (si es `admin`) la de «Administrar usuarios» siguen mostrándose igual.
- [ ] El enlace «Registrar donación» navega a `/dashboard/donaciones/nueva`.
- [ ] `/dashboard/donaciones/nueva` responde 200 con una sesión activa y muestra el navbar del panel y el marcador del formulario futuro.
- [ ] La página destino no contiene ningún `<form>`, `<input>` ni `<script>`, y no hace peticiones a `/api/*` al cargar.
- [ ] «Volver al panel» navega a `/dashboard`.
- [ ] Sin sesión, `/dashboard/donaciones/nueva` responde 302 a `/auth/login?next=%2Fdashboard%2Fdonaciones%2Fnueva`.
- [ ] Con una cuenta `inactivo`, la ruta aplica el bloqueo de SPEC 08.
- [ ] A 320 px no hay scroll horizontal en `/dashboard` ni en `/dashboard/donaciones/nueva`.
- [ ] No hay errores de consola en ninguna de las dos pantallas.
- [ ] `README.md` y `AGENTS.md` reflejan la ruta nueva, la feature `donations` y el árbol final de `src/`.

## Decisiones tomadas y descartadas

- **Sí:** ruta anidada `/dashboard/donaciones/nueva`. Deja espacio a un listado en `/dashboard/donaciones` y a una edición por id sin reestructurar nada, igual que `/dashboard/admin/users`.
- **No:** `/dashboard/registro` (no dice qué se registra ni admite listado) ni `/dashboard/donantes/nuevo` (el sujeto del formulario es la donación, no la persona).
- **Sí:** solo la parte visual. Diseñar los campos antes de acordar la tabla de destino obligaría a rehacerlos; el marcador deja claro que la pantalla es intencional.
- **No:** maquetar un formulario sin lógica. Un formulario que no guarda nada es peor que un marcador: parece terminado y no lo está.
- **Sí:** visible para todos los roles activos. La captura no es una tarea administrativa y no hay ninguna regla de negocio que la restrinja hoy.
- **No:** `403` para roles distintos de `admin`/`supervisor`. Sería una restricción inventada, y en este proyecto la autorización vive en el frontmatter de la página, no en el `href`.
- **Sí:** la tarjeta del panel en `src/features/dashboard/components/`, junto a `AdminUsersShortcutCard`. Es una entrada del panel; mantener las dos tarjetas juntas conserva el criterio ya fijado en SPEC 06.
- **No:** poner la tarjeta en `src/features/donations/components/`. La feature `donations` nace con la pantalla destino; la tarjeta pertenece al panel.
- **Sí:** un componente para la tarjeta del panel y otro para la tarjeta de la página destino, en lugar de uno compartido con props. El contenido y el destino son distintos y no hay nada que parametrizar.
- **Sí:** la página destino lleva un enlace «Volver al panel». Evita el callejón sin salida del botón «atrás» del navegador.
- **Sí:** el redirect a login lo repite el frontmatter de la página, como en `/dashboard/admin/users`. El middleware ya cubre el caso; la repetición es defensa en profundidad y mantiene el patrón del resto de páginas del panel.
- **No:** añadir el enlace al navbar. El navbar es el mismo para todas las páginas y hoy solo tiene el cierre de sesión; convertirlo en menú es otro spec.
- **No:** tocar `src/styles/global.css`. Se usan los componentes de daisyUI que ya están en el tema.

## Riesgos

| Riesgo | Mitigación |
| --- | --- |
| El marcador se confunde con una pantalla rota | El texto dice explícitamente que el formulario llegará en una entrega posterior, y el spec deja claro que es intencional. |
| La ruta nueva queda sin entrada si alguien borra la tarjeta | El enlace y la ruta se prueban juntos en Playwright; el `curl` cubre el caso sin sesión. |
| La página crece con lógica antes de su spec | El criterio «sin `<form>`, sin `<input>`, sin `<script>`» es comprobable en el HTML servido. |
| La tarjeta nueva rompe la composición del panel | Es una tarjeta más en el `main` con el mismo ancho y patrón que las existentes; se revisa a 320 px en Playwright. |
| Un futuro spec de formulario reutiliza la ruta y cambia el marcador | Es el resultado esperado: este spec fija el punto de entrada y la ruta, no el contenido final de la pantalla. |

## Qué **no** entra en este spec

- Los campos del formulario y sus validaciones.
- La tabla de donaciones (o de donantes), sus migraciones, RLS y tipos generados.
- Cualquier endpoint de API nuevo o ampliado.
- Listado, edición o borrado de donaciones.
- Guardas de autorización por rol.
- Menú lateral, breadcrumbs o reordenación del panel.
- Cambios en `src/middleware.ts`, `src/styles/global.css`, `astro.config.mjs` o las variables de entorno.

## Verificación

> Pendiente. Se completará tras la implementación.

| Criterio | Estado | Evidencia | Notas |
| --- | --- | --- | --- |
| — | ⏳ | — | — |
