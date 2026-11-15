# SPEC 05 — Refactorización FDD, componentes reutilizables y AGENTS.md

> **Estado:** Implementado
> **Depende de:** SPEC 01, SPEC 02, SPEC 03, SPEC 04
> **Fecha:** 2026-11-11
> **Objetivo:** Reorganizar `src/` por funcionalidad con carpetas `features/`, extraer los componentes de Astro que se repiten y reescribir `AGENTS.md` para las integraciones futuras, sin cambiar el comportamiento observable del sitio.

## Por qué existe este spec

El proyecto creció spec a spec: cada entrega añadió archivos a `src/pages/` y `src/lib/` sin una convención de dónde iban. El resultado es que `src/` se organiza por tipo de archivo (páginas, librerías) y no por funcionalidad, y el mismo marcado está copiado entre tres y cuatro veces.

El coste ya es visible: el bloque `<head>` idéntico en las cuatro páginas, el patrón `main > section.card > card-body` en tres, `fieldset + label + input` en cuatro y el `alert alert-error` en tres. Cada feature nueva (panel administrativo, registro, recuperación de contraseña) duplicaría eso otra vez.

Este spec fija la estructura y las reglas antes de que llegue la siguiente integración.

## Alcance

**Incluido:**

- `src/components/ui/` con `BaseLayout.astro` y `AlertError.astro` (usados por más de una feature).
- `src/features/auth/components/` con `AuthCard.astro`, `FormField.astro` y `PasswordInput.astro`.
- `src/features/dashboard/components/` con `AppNavbar.astro`.
- Mover `src/lib/email.ts` y `src/lib/supabase-admin.ts` a `src/features/invitations/lib/`.
- `src/pages/` conserva enrutado y frontmatter; solo cede el markup a componentes.
- Reescritura de `AGENTS.md` con la estructura final, la receta para añadir features y componentes, y las reglas de integración.
- Verificación con `npm run build`, `npx tsc --noEmit`, diff del HTML servido y Playwright a 320 px.

**Fuera de alcance (para specs futuros):**

- Cualquier cambio de comportamiento, URL, texto, clase CSS o accesibilidad.
- Añadir el toggle de contraseña a `/auth/update-password`.
- Extraer la lógica de `src/pages/api/` a funciones de dominio.
- Mover `src/middleware.ts`, `src/env.d.ts`, `src/styles/global.css`, `src/lib/supabase.ts` o `src/lib/database.types.ts`.
- Componentes de un solo uso: `ProfileCard`, el `<dl>` del perfil y el estado de error de `/auth/confirm`.
- Modificar los specs 01-04.
- Nuevas features: panel administrativo, registro público, recuperación de contraseña.
- Tests automatizados, linter o formateador.
- Cambios en Supabase, RLS, migraciones o variables de entorno.

## Modelo de datos

Este spec no introduce datos ni persistencia. Reutiliza `auth.users`, `public.usuarios` y la sesión en cookies tal como están en SPEC 02 y SPEC 03. Solo cambia la ubicación de dos archivos TypeScript: `src/lib/email.ts` y `src/lib/supabase-admin.ts` pasan a `src/features/invitations/lib/`.

## Estructura objetivo

```text
src/
├── middleware.ts                          # sin cambios
├── env.d.ts                               # sin cambios
├── styles/global.css                      # sin cambios
├── lib/
│   ├── database.types.ts                  # infra compartida
│   └── supabase.ts                        # infra compartida
├── components/
│   └── ui/
│       ├── BaseLayout.astro               # <head>, <body class="bg-base-200">, importa global.css
│       └── AlertError.astro               # role="alert" + alert alert-error (+ alert-soft)
├── features/
│   ├── auth/
│   │   └── components/
│   │       ├── AuthCard.astro             # main > section.card > card-body
│   │       ├── FormField.astro            # fieldset + label + input (o slot)
│   │       └── PasswordInput.astro        # div.input + input + botón toggle + su script
│   ├── dashboard/
│   │   └── components/
│   │       └── AppNavbar.astro            # navbar + «Cerrar sesión»
│   └── invitations/
│       └── lib/
│           ├── email.ts                   # movido desde src/lib/
│           └── supabase-admin.ts          # movido desde src/lib/
└── pages/
    ├── dashboard.astro
    ├── auth/{login,confirm,update-password}.astro
    └── api/
        ├── invitations.ts
        └── auth/{login,logout}.ts
```

### Contrato de cada componente

| Componente | Props | Debe producir exactamente |
| --- | --- | --- |
| `BaseLayout` | `title: string` | `<html lang="es">`, `<head>` con charset, los dos favicons, viewport y `<title>{title}</title>`; `<body class="bg-base-200">` con `<slot />`. Importa `../../styles/global.css`. |
| `AlertError` | `soft?: boolean` | `<div role="alert" class="alert alert-error">`, más `alert-soft` solo si `soft`. Contenido por `<slot />`. |
| `AuthCard` | ninguna | `<main class="flex min-h-svh items-center justify-center p-4 sm:p-6">` → `<section class="card w-full max-w-sm bg-base-100 shadow-xl">` → `<div class="card-body gap-4">` con `<slot />`. |
| `FormField` | `id`, `label`, `type?`, `name?` (por defecto `id`), `required?`, `minlength?`, `autocomplete?` | `<fieldset class="fieldset">` → `<label class="label" for={id}>{label}</label>` → por defecto `<input>` con `class="input w-full"`; si se pasa `<slot />`, este sustituye al input. |
| `PasswordInput` | ninguna | `<div class="input w-full">` con `#password` (`type="password"`, `class="grow"`, `required`, `autocomplete="current-password"`), `#password-toggle` con sus dos SVG y su `<script>` de SPEC 04. |
| `AppNavbar` | ninguna | `<header class="navbar bg-base-100 px-4 shadow-sm">` con la marca «Dona de sangre» y el formulario `POST /api/auth/logout`. |

`FormField` debe emitir los atributos del `<input>` en este orden para reproducir el markup actual: `id`, `name`, `type`, `class`, `required`, `minlength`, `autocomplete`, omitiendo los que no apliquen.

## Plan de implementación

1. Crear `src/components/ui/BaseLayout.astro` y migrar `src/pages/auth/login.astro`, retirando su `<head>`, su `body class="bg-base-200"` y su import de `global.css`. Verificar con `npm run build` y comprobar en el navegador que el login se ve igual.
2. Migrar `src/pages/auth/confirm.astro` y `src/pages/auth/update-password.astro` a `BaseLayout`. Verificar build y que las dos pantallas conservan sus títulos.
3. Migrar `src/pages/dashboard.astro` a `BaseLayout`. Verificar build y que el navbar y el perfil siguen en su sitio.
4. Crear `src/components/ui/AlertError.astro` y usarlo en `login.astro`, `update-password.astro` y `dashboard.astro` (con `soft` en las dos primeras). Verificar build y que los tres mensajes de error siguen visibles.
5. Crear `src/features/auth/components/AuthCard.astro` y usarlo en `login.astro`, `confirm.astro` y `update-password.astro`. Verificar build y que las tres tarjetas conservan su ancho y centrado.
6. Crear `src/features/auth/components/FormField.astro` y reemplazar los cuatro `fieldset`: correo y contraseña en login, contraseña y confirmación en update-password. Verificar build y que los `id`, `name`, `required`, `minlength` y `autocomplete` no cambian.
7. Crear `src/features/auth/components/PasswordInput.astro` moviendo el markup del campo de contraseña y el bloque de toggle del `<script>` de `login.astro`; la página conserva el bloque de envío. Verificar build y probar mostrar/ocultar contraseña con puntero y teclado.
8. Crear `src/features/dashboard/components/AppNavbar.astro` y usarlo en `dashboard.astro`. Verificar build y que «Cerrar sesión» sigue enviando a `/api/auth/logout`.
9. Mover `src/lib/email.ts` y `src/lib/supabase-admin.ts` a `src/features/invitations/lib/`, corregir el import relativo a `database.types` dentro de `supabase-admin.ts` y el de `src/pages/api/invitations.ts`. Verificar con `npx tsc --noEmit` y `npm run build`.
10. Reescribir `AGENTS.md` conservando íntegramente su contenido actual (Project, Commands, Dev server, Styling, Supabase, Email, Spec workflow, References), actualizando las rutas que cambiaron y añadiendo las secciones nuevas descritas más abajo.

### Contenido mínimo de `AGENTS.md`

- Árbol de la estructura final y qué vive en cada carpeta.
- Regla: `src/pages/` contiene solo enrutado y frontmatter; el markup va a componentes.
- Regla: dónde vive cada componente (`src/components/ui/` si cruza features, `src/features/<f>/components/` si es de una sola).
- Regla: `src/lib/` es infra multi-feature; lo que solo usa una feature va a `src/features/<f>/lib/`.
- Receta «añadir una feature», paso a paso.
- Receta «añadir un componente», con el criterio de extracción de dos o más usos y la prohibición de props especulativas.
- Reglas de seguridad que no cambian: secretos server-only, RLS por tabla, `service_role` solo en servidor.
- Referencias a archivos actualizadas, sin ninguna ruta que ya no exista.

## Criterios de aceptación

- [x] `npm run build` termina correctamente.
- [x] `npx tsc --noEmit` no reporta errores.
- [x] `src/lib/email.ts` y `src/lib/supabase-admin.ts` ya no existen y ningún archivo los importa desde `src/lib/`.
- [x] Las cuatro páginas importan `BaseLayout` y ninguna declara su propio `<head>` ni su propio `<body>`.
- [x] El HTML servido de `/auth/login`, `/auth/confirm`, `/auth/update-password` y `/dashboard` es idéntico al de la rama base, salvo las rutas con hash de `/_astro/*` y el número y orden de las etiquetas `<script>` y `<link rel="stylesheet">`.
- [x] El formulario de login conserva `method="post"`, `action="/api/auth/login"` y los campos `email` y `password` con sus `id`, `name`, `required` y `autocomplete` originales.
- [x] El toggle de contraseña cambia `type` entre `password` y `text`, conserva el valor, alterna `aria-label` entre «Mostrar contraseña» y «Ocultar contraseña» y no envía el formulario.
- [x] Sin JavaScript, la contraseña permanece oculta y el botón del toggle sigue oculto.
- [x] `/auth/update-password` conserva `minlength="8"` y `autocomplete="new-password"` en ambos campos y su envío a `/auth/update-password`.
- [x] `/dashboard` conserva el navbar con «Cerrar sesión» enviando a `POST /api/auth/logout`.
- [x] Los tres mensajes de error mantienen `role="alert"`, con `alert alert-error alert-soft` en login y update-password y `alert alert-error` en dashboard.
- [ ] `POST /api/invitations` sigue respondiendo 401 sin sesión, 403 con rol `capturador` y 200 con rol `admin`.
- [x] A 320 px no hay scroll horizontal en las cuatro pantallas.
- [x] No hay errores de consola durante el recorrido de las cuatro pantallas.
- [x] `AGENTS.md` describe la estructura final, las dos recetas y las reglas de integración, y no contiene ninguna ruta que ya no exista.
- [x] `specs/01-login.md`, `specs/02-auth-supabase.md`, `specs/03-invitacion-confirmacion.md` y `specs/04-toggle-visibilidad-contrasena.md` no contienen cambios.

## Decisiones tomadas y descartadas

- **Sí:** `src/pages/` sigue siendo el enrutado de Astro y la feature aporta componentes, no rutas. Astro exige las páginas en `src/pages`.
- **No:** modelo con `features/*/pages` y envoltorios de tres líneas. Los `Astro.redirect` viven en el frontmatter de la página; envolverlos añade una capa sin ganar nada.
- **Sí:** `src/components/ui/` para lo que cruza features (`BaseLayout`, `AlertError`).
- **No:** meter `BaseLayout` en una feature: lo usan las cuatro pantallas.
- **Sí:** extraer solo lo usado dos o más veces, más `AppNavbar` y `PasswordInput`, aceptados explícitamente porque aíslan el navbar y la SPEC 04.
- **No:** `ProfileCard` y el `<dl>` del perfil. Un solo uso; la abstracción cuesta más que la duplicación.
- **Sí:** mover `email.ts` y `supabase-admin.ts` a `features/invitations/lib/`: solo los usa el endpoint de invitaciones.
- **No:** mover `supabase.ts` ni `database.types.ts`. Son infra compartida (middleware, dashboard, `env.d.ts`) y no pertenecen a ninguna feature.
- **Sí:** `BaseLayout` importa `global.css`. Ninguna página tiene que acordarse de la hoja de estilos.
- **No:** crear `features/auth/lib/errors.ts`. Los mapas de error de login y update-password no comparten claves; fusionarlos no ahorra nada.
- **Sí:** conservar `id`, `name` y el script de SPEC 04 tal cual dentro de `PasswordInput`.
- **No:** dar props a `PasswordInput` que nadie consume hoy.
- **Sí:** reescribir `AGENTS.md` completo con estructura, recetas y reglas, no solo corregir rutas.
- **No:** tocar los specs 01-04. Son registro histórico de cómo se verificó cada entrega.
- **No:** extraer la lógica de `src/pages/api/*` a funciones de dominio: los handlers ya son cortos y no se reutilizan.

## Riesgos

| Riesgo | Mitigación |
| --- | --- |
| El diff de HTML muestra diferencias por orden de atributos o posición del CSS | `FormField` emite los atributos en el orden del markup actual; solo se aceptan cambios de assets. Cualquier otra diferencia es un fallo. |
| Mover el script de SPEC 04 rompe el toggle | Playwright verifica mostrar/ocultar, `aria-label`, conservación del valor y que no envía el formulario. |
| Un import relativo mal corregido rompe el build | `npx tsc --noEmit` y `npm run build` tras cada paso del plan. |
| `AGENTS.md` queda a medio actualizar y guía mal a la próxima integración | Es el último paso del plan y se reescribe entero; criterio de aceptación que no queden rutas obsoletas. |
| Abstracción prematura: componentes con props que nadie usa | Criterio de extracción de dos o más usos y sin props especulativas. |
| Se pierde la verificación de las entregas anteriores | Los specs 01-04 no se tocan y este spec repite sus comprobaciones clave. |

## Qué **no** entra en este spec

- Cambios de comportamiento, URL, texto o accesibilidad.
- Toggle de contraseña en `/auth/update-password`.
- Lógica de dominio extraída de los endpoints.
- Componentes de un solo uso.
- Ediciones en los specs 01-04.
- Panel administrativo, registro público y recuperación de contraseña.
- Tests automatizados, linter y formateador.
- Cambios en Supabase, RLS, migraciones o variables de entorno.

Cada uno de esos puntos, si llega, va en su propio spec.

## Verificación

> **Fecha:** 2026-11-11
> **Resultado:** 15/16 criterios verificados (1 pendiente por falta de autorización para crear datos reales)

Método: se compiló la rama del spec y la rama base `main` (`191a4c1`, merge-base) y se sirvieron ambas con el mismo
handler SSR de `@astrojs/netlify` (`createHandler`), para comparar el HTML servido. Las páginas protegidas se
renderizaron con una sesión efímera creada con `auth.admin.generateLink` (magiclink) validada por el propio
`/auth/confirm` de la app; no se creó ni modificó ningún usuario, perfil, invitación ni correo.

| Criterio | Estado | Evidencia | Notas |
| --- | --- | --- | --- |
| `npm run build` termina correctamente | ✅ | `npm run build` → `[build] Complete!`; solo los 2 avisos no fatales `Invalid empty selector` de daisyUI | Sin errores |
| `npx tsc --noEmit` no reporta errores | ✅ | `npx tsc --noEmit` → exit 0, sin salida | — |
| `src/lib/email.ts` y `src/lib/supabase-admin.ts` ya no existen y nadie los importa desde `src/lib/` | ✅ | `git diff main` → `R100 src/lib/email.ts → src/features/invitations/lib/email.ts`, `R090 src/lib/supabase-admin.ts → src/features/invitations/lib/supabase-admin.ts`; `grep "lib/(email\|supabase-admin)" src/` → solo `src/pages/api/invitations.ts:2-3` (importa de `features/invitations/lib/`) | — |
| Las cuatro páginas importan `BaseLayout` y ninguna declara su propio `<head>` ni su propio `<body>` | ✅ | `grep -rn "BaseLayout" src/pages/` → 4 páginas; `grep -rn "<head>\|<body" src/pages/` → sin resultados; HTML servido: 1 `<html>`, 1 `<head>`, 1 `<body>` por página y `<title>` correcto en las cuatro | — |
| HTML servido idéntico al de la rama base (salvo assets y etiquetas `<script>`/`<link>`) | ✅ | Diff normalizado (`/_astro/…` → `_astro/ASSET`) de las 4 rutas: `/auth/confirm`, `/dashboard` y `/auth/update-password` (con y sin `?error=corta`) **idénticos byte a byte**; `/auth/login` idéntico salvo que el `<script>` único de la base pasa a **dos** `<script>` (toggle de SPEC 04 + envío), lo que el criterio permite | El CSS generado añade una regla `.isolate{isolation:isolate}` sin uso: Tailwind la detecta por la palabra «isolate» del nuevo `AGENTS.md`; ningún elemento usa esa clase, el render no cambia |
| El formulario de login conserva `method`, `action`, y los campos `email` y `password` | ✅ | Playwright: `#login-form` → `method="post"`, `action="/api/auth/login"`; `<input id="email" name="email" type="email" class="input w-full" required autocomplete="email">`; `<input id="password" name="password" type="password" class="grow" required autocomplete="current-password">` | Idéntico al HTML servido de la base |
| El toggle cambia `type`, conserva el valor, alterna `aria-label` y no envía el formulario | ✅ | Playwright (puntero): `password`→`text`, valor `ClaveSecreta123` intacto, `aria-label` «Mostrar contraseña»→«Ocultar contraseña», iconos intercambiados, URL sin cambios y `#login-submit` sin deshabilitar; teclado (Enter y Space) idéntico | — |
| Sin JavaScript la contraseña sigue oculta y el botón del toggle también | ✅ | HTML servido: `<input id="password" … type="password" …>` y `<button id="password-toggle" … class="btn btn-ghost btn-square btn-sm hidden">`; la clase `hidden` solo la quita el `<script>` de `PasswordInput.astro`; el bundle CSS incluye `.hidden{display:none}` | Igual que en la base |
| `/auth/update-password` conserva `minlength="8"`, `autocomplete="new-password"` y el envío a `/auth/update-password` | ✅ | Playwright: `#password` y `#password_confirm` → `type="password"`, `required`, `minlength="8"`, `autocomplete="new-password"`, `class="input w-full"`; `#password-form` → `method="post"`, `action="/auth/update-password"`; sin toggle (fuera de alcance) | — |
| `/dashboard` conserva el navbar con «Cerrar sesión» → `POST /api/auth/logout` | ✅ | Playwright: `header.navbar` = `navbar bg-base-100 px-4 shadow-sm`, marca «Dona de sangre», `form[method=post][action="/api/auth/logout]` con botón «Cerrar sesión»; clic → `POST /api/auth/logout` → 302 a `/auth/login` (HTML de login tras el clic) | — |
| Los tres mensajes de error mantienen `role="alert"` y sus clases | ✅ | Login (`?error=invalid_credentials`): `role="alert"`, `alert alert-error alert-soft`; update-password (`?error=corta`): `role="alert"`, `alert alert-error alert-soft`; dashboard: `AlertError` sin `soft` → `role="alert"`, `alert alert-error` (render del componente verificado en una copia temporal fuera del repo; el markup de la base era idéntico) | — |
| `POST /api/invitations` responde 401 sin sesión, 403 con rol `capturador` y 200 con rol `admin` | ⚠️ | 401 verificado: `POST /api/invitations` sin cookie → `401 {"error":"No autorizado."}` (igual que la base). **403 y 200 no ejecutados**: no se autorizó crear un usuario `capturador` ni ejecutar el POST real como admin (crea un invitado y envía un email por Gmail SMTP) | Código de la guarda sin cambios respecto a la base: `src/pages/api/invitations.ts:36-38` (`usuario?.rol !== 'admin'` → 403). Pendiente de autorización para datos reales |
| A 320 px no hay scroll horizontal en las cuatro pantallas | ✅ | Playwright a 320×720: `scrollWidth === clientWidth === 320` en `/auth/login`, `/auth/confirm`, `/auth/update-password` y `/dashboard` | — |
| No hay errores de consola durante el recorrido de las cuatro pantallas | ✅ | `browser_console_messages` → 0 errores y 0 warnings en las cuatro pantallas; solo un mensaje VERBOSE de Chrome («Password forms should have (optionally hidden) username fields») que también aparece en la rama base | Preexistente, no introducido por el refactor |
| `AGENTS.md` describe estructura, recetas y reglas, sin rutas obsoletas | ✅ | Árbol de `AGENTS.md` contrastado con `src/` real: los 20 archivos de `src/` aparecen y todas las rutas citadas existen (los `<f>`, `<name>` y `{…}` son plantillas); incluye árbol, regla de `src/pages/`, regla de ubicación de componentes, regla de `src/lib/`, receta «add a feature» (5 pasos), receta «add a component» (5 pasos) y la sección de seguridad | — |
| Los specs 01-04 no contienen cambios | ✅ | `git diff main -- specs/01-login.md specs/02-auth-supabase.md specs/03-invitacion-confirmacion.md specs/04-toggle-visibilidad-contrasena.md` → vacío | — |

Estado del proyecto Supabase tras la verificación: 1 usuario (`auth.users`), 1 perfil (`public.usuarios`), 0 sesiones
(`auth.sessions`); no se creó ni borró ninguna fila.
