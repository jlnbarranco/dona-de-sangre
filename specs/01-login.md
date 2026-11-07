# SPEC 01 — Pantalla de login

> **Estado:** Implementado
> **Depende de:** —
> **Fecha:** 2026-11-07
> **Objetivo:** Crear la pantalla visual de login en `/auth/login` con título, email, contraseña y botón, y redirigir `/` a esa ruta.

## Por qué existe este spec

Es la primera pantalla del producto y todavía no existe autenticación real. Este spec fija el contrato visual y de rutas para que la conexión con Supabase se haga después sin rehacer la interfaz.

## Alcance

**Incluido:**

- Página `src/pages/auth/login.astro` con título «Dona de sangre», campo de correo, campo de contraseña, enlace «¿Olvidaste tu contraseña?» y botón «Iniciar sesión».
- Tema DaisyUI propio «rojo sangre» en variante clara y oscura automática, en `src/styles/global.css`.
- Redirección de `/` a `/auth/login` con `redirects` en `astro.config.mjs`.
- Eliminación de la página de ejemplo `src/pages/index.astro`.
- Validación HTML nativa (`type="email"`, `required`, `autocomplete`).
- Script mínimo que impide el envío real del formulario.
- Diseño responsive mobile-first: la tarjeta se adapta de 320 px (móvil) a escritorio, sin scroll horizontal.

**Fuera de alcance (para specs futuros):**

- Autenticación real con Supabase: sesión, cookies, middleware y rutas protegidas.
- Mensajes de error, credenciales inválidas y estado de carga del botón.
- Registro de usuarios, recuperación real de contraseña y «recordarme».
- Selector de tema claro/oscuro visible para el usuario.
- Logo, imágenes, iconos o fuentes personalizadas.

## Modelo de datos

Este spec no introduce estructuras de datos ni persistencia. Solo fija el contrato de los campos para poder conectarlos a Supabase más adelante:

| Campo      | `name` / `id` | `type`     | Atributos                                     |
| ---------- | ------------- | ---------- | --------------------------------------------- |
| Correo     | `email`       | `email`    | `required`, `autocomplete="email"`            |
| Contraseña | `password`    | `password` | `required`, `autocomplete="current-password"` |

El formulario no tiene `action`. Usa `method="post"` para que, si el script falla, la contraseña no acabe en la URL.

## Especificación visual

### Tema

En `src/styles/global.css`:

- `@plugin "daisyui" { themes: false; }` para desactivar los temas incorporados.
- Tema `dona`: claro, `default: true`, `prefersdark: false`, `color-scheme: light`.
- Tema `dona-dark`: oscuro, `default: false`, `prefersdark: true`, `color-scheme: dark`.
- `--color-primary` en tono carmesí/sangre (familia de matiz ~22 en OKLCH):
  - Claro: `oklch(48% 0.19 22)`; `--color-primary-content: oklch(98% 0.01 22)`.
  - Oscuro: `oklch(62% 0.20 22)`; `--color-primary-content: oklch(15% 0.02 22)`.
- Ambos temas definen el juego completo de tokens de color (`base-100`, `base-200`, `base-300`, `base-content`, `primary`, `secondary`, `accent`, `neutral`, `info`, `success`, `warning`, `error` y sus `*-content`) y los tokens de radio, tamaño, borde, profundidad y ruido.

### Composición

- `<html lang="es">`.
- `<title>Iniciar sesión | Dona de sangre</title>`.
- `<body class="bg-base-200">`.
- `<main class="flex min-h-svh items-center justify-center p-4 sm:p-6">`.
- `<section class="card w-full max-w-sm bg-base-100 shadow-xl">` con `<div class="card-body gap-4">`.
- Título: `<h1 class="card-title justify-center text-2xl">Dona de sangre</h1>`.
- Formulario: `<form id="login-form" class="flex flex-col gap-4" method="post">`.
- Cada campo dentro de un `<fieldset class="fieldset">` con `<label class="label" for="...">`:
  - Correo: `<input id="email" name="email" type="email" class="input w-full" required autocomplete="email" />`.
  - Contraseña: `<input id="password" name="password" type="password" class="input w-full" required autocomplete="current-password" />`.
- Enlace bajo la contraseña, alineado a la derecha:
  `<a href="#" class="link link-hover text-sm">¿Olvidaste tu contraseña?</a>`. Sin destino real.
- Botón: `<button type="submit" class="btn btn-primary w-full">Iniciar sesión</button>`.
- Sin placeholders, sin logo y sin textos adicionales.

### Responsive

- Enfoque mobile-first: las clases base son para móvil y los ajustes de espaciado usan prefijos `sm:`.
- La tarjeta usa `w-full max-w-sm`: ocupa todo el ancho disponible en móvil y se limita a 24rem en escritorio.
- Inputs y botón usan `w-full`, por lo que ocupan todo el ancho de la tarjeta.
- `min-h-svh` evita el salto de altura de la barra del navegador móvil.
- Sin `overflow-hidden` ni alturas fijas: si el contenido supera el alto del viewport (móvil en horizontal), la página hace scroll vertical en lugar de recortarse.
- Sin scroll horizontal en ningún ancho.

### Comportamiento

```html
<script>
  document.getElementById('login-form')?.addEventListener('submit', (event) => event.preventDefault())
</script>
```

La validación nativa del navegador se ejecuta antes del evento `submit`. Con campos válidos, el formulario no navega ni recarga.

## Plan de implementación

1. Actualizar `src/styles/global.css`: desactivar temas incorporados y definir `dona` y `dona-dark`. Verificar que la página actual sigue renderizando con los nuevos colores base.
2. Crear `src/pages/auth/login.astro` con el marcado completo e importar `../../styles/global.css`. Verificar `/auth/login` en `npm run dev` a 320 px, 768 px y 1440 px de ancho.
3. Añadir el script que hace `preventDefault()` en el submit. Verificar que Enter y el clic no recargan, y que los campos vacíos muestran la validación nativa.
4. Añadir `redirects: { '/': '/auth/login' }` en `astro.config.mjs` y eliminar `src/pages/index.astro`. Verificar que `/` redirige y que `/auth/login` sigue funcionando.
5. Ejecutar `npm run build` e inspeccionar `dist/`: debe existir `dist/auth/login/index.html` y `dist/index.html` con el meta refresh.

## Criterios de aceptación

- [x] `npm run build` termina sin errores.
- [x] Existe `dist/auth/login/index.html`.
- [x] Existe `dist/index.html` y contiene `<meta http-equiv="refresh"` apuntando a `/auth/login`.
- [x] En `npm run dev`, visitar `/` lleva a `/auth/login`.
- [x] `/auth/login` muestra «Dona de sangre» como `<h1>`.
- [x] Hay exactamente un input `type="email"` con `name="email"`, `required` y `autocomplete="email"`.
- [x] Hay exactamente un input `type="password"` con `name="password"`, `required` y `autocomplete="current-password"`.
- [x] El botón dice «Iniciar sesión», es `type="submit"` y usa `btn btn-primary w-full`.
- [x] Existe el enlace «¿Olvidaste tu contraseña?» y su destino es `#`.
- [x] Enviar con datos válidos no recarga la página ni cambia la URL.
- [x] Enviar con campos vacíos muestra la validación nativa y no dispara el submit.
- [x] A 320 px de ancho no hay scroll horizontal y todos los elementos son visibles.
- [x] La tarjeta tiene 16 px de margen lateral en móvil y un máximo de 24rem en escritorio.
- [x] A 768 px y 1440 px la tarjeta sigue centrada y con el mismo ancho máximo.
- [x] Los dos inputs y el botón ocupan todo el ancho de la tarjeta.
- [x] A 568×320 (móvil en horizontal) el formulario es accesible con scroll vertical, sin recortes.
- [x] Con `prefers-color-scheme: light` se aplica `dona`; con `dark`, `dona-dark`.
- [x] El texto sobre `bg-base-100`, `bg-base-200` y `btn-primary` cumple contraste ≥ 4.5:1.
- [x] No hay errores en la consola del navegador.
- [x] No queda ningún texto del starter de Astro.

## Decisiones tomadas y descartadas

- **Sí:** redirect configurado en `astro.config.mjs` y borrar `src/pages/index.astro`. Una página en `src/pages` tiene prioridad sobre un redirect configurado; borrarla evita duplicar la pantalla.
- **No:** `Astro.redirect()` dentro de `index.astro`. Logra lo mismo pero conserva un archivo de página inútil.
- **Sí:** una sola página `src/pages/auth/login.astro` que importa `global.css`. El proyecto no tiene layout y `AGENTS.md` marca ese patrón.
- **Sí:** temas propios `dona` / `dona-dark` con `themes: false`. Evita que el violeta por defecto de DaisyUI se cuele y da control total del rojo sangre.
- **Sí:** `btn-primary` solo en el botón. DaisyUI recomienda usar `primary` una sola vez, en el elemento más importante.
- **Sí:** validación HTML nativa + `preventDefault()`. Da feedback inmediato sin lógica de negocio.
- **Sí:** `method="post"`. Si el script falla, la contraseña no aparece en la URL.
- **Sí:** mobile-first con `min-h-svh` y `w-full max-w-sm`. `min-h-svh` evita el salto de altura de la barra del navegador móvil y el ancho máximo mantiene la legibilidad en escritorio.
- **No:** placeholders. Las etiquetas visibles ya nombran los campos.
- **No:** logo, iconos o fuentes personalizadas. No se pidieron y no aportan al contrato.
- **No:** selector de tema visible. El modo oscuro se resuelve con `prefers-color-scheme`.

## Riesgos

| Riesgo                                              | Mitigación                                                                          |
| --------------------------------------------------- | ----------------------------------------------------------------------------------- |
| El redirect estático es un meta refresh             | En hosting real, configurar un 301 a nivel de servidor o CDN.                       |
| `themes: false` elimina `light` y `dark`            | Usar `dona` / `dona-dark`; si hace falta otro tema, habilitarlo en `global.css`.     |
| Contraste insuficiente del rojo                     | Verificar `primary` / `primary-content` ≥ 4.5:1 en ambos temas.                     |
| El autofill del navegador cambia el fondo del input | Aceptado; no se sobreescribe el estilo de autofill.                                 |
| JavaScript deshabilitado                            | El formulario hace POST a la misma URL y el hosting estático responde 405; la contraseña no queda en la URL. |

## Qué **no** entra en este spec

- Autenticación con Supabase, sesión, cookies, middleware y rutas protegidas.
- Mensajes de error, estado de carga, «recordarme» y recuperación real de contraseña.
- Registro de usuarios.
- Selector de tema, logo, imágenes o fuentes personalizadas.

Cada uno de esos puntos, si llega, va en su propio spec.

## Verificación

> **Fecha:** 2026-11-07
> **Resultado:** 20/20 criterios verificados

> **Nota:** la verificación inicial quedó en 17/20 por falta de Chrome. Tras instalarlo, los 3 criterios pendientes (320 px, 568×320 y consola) se comprobaron con Playwright sobre el dev server en `http://localhost:4321`.

| Criterio | Estado | Evidencia | Notas |
| --- | --- | --- | --- |
| `npm run build` termina sin errores | ✅ | `npm run build` → `1 page(s) built`, `Complete!`, exit 0 | Solo emite 2 warnings no fatales `Invalid empty selector` de daisyUI |
| Existe `dist/auth/login/index.html` | ✅ | Archivo leído; generado en el build | — |
| Existe `dist/index.html` con meta refresh a `/auth/login` | ✅ | `dist/index.html` línea 1: `<meta http-equiv="refresh" content="0;url=/auth/login">` | Redirect estático de Astro; también `<link rel="canonical" href="/auth/login">` |
| En dev, `/` lleva a `/auth/login` | ✅ | `fetch('http://localhost:4321/')` termina en `http://localhost:4321/auth/login` (200) | Servidor dev ya activo en el puerto 4321 |
| `/auth/login` muestra «Dona de sangre» como `<h1>` | ✅ | HTML servido y `dist/auth/login/index.html`: un solo `<h1>` con ese texto; `src/pages/auth/login.astro:17` | — |
| Un input email con `name`, `required`, `autocomplete` | ✅ | HTML servido: 1 coincidencia `<input id="email" name="email" type="email" ... required autocomplete="email">`; `login.astro:21` | — |
| Un input password con `name`, `required`, `autocomplete` | ✅ | HTML servido: 1 coincidencia `<input id="password" name="password" type="password" ... required autocomplete="current-password">`; `login.astro:25` | — |
| Botón «Iniciar sesión», `type="submit"`, `btn btn-primary w-full` | ✅ | HTML servido: `<button type="submit" class="btn btn-primary w-full">Iniciar sesión</button>`; `login.astro:30` | — |
| Enlace «¿Olvidaste tu contraseña?» con destino `#` | ✅ | HTML servido: `<a href="#" class="link link-hover text-sm">`; `login.astro:27` | — |
| Enviar con datos válidos no recarga ni cambia la URL | ✅ | Playwright: tras rellenar y pulsar el botón, `location.href` sigue en `/auth/login`, el marcador `window` sobrevive y `performance` mantiene 1 navegación; el `submit` se dispara 1 vez. Igual al pulsar Enter en la contraseña | Observado en navegador (clic y Enter) |
| Enviar vacío muestra validación nativa y no dispara submit | ✅ | Playwright: con campos vacíos, el clic deja `form.checkValidity() === false`, enfoca `#email` y no dispara el evento `submit` (`submitCount === 0`); sin navegación | Observado en navegador |
| A 320 px sin scroll horizontal y todo visible | ✅ | Playwright a 320×568: `scrollWidth === clientWidth === 320`, sin scroll horizontal; tarjeta en x=16, ancho 288; inputs y botón de 240 px dentro de la tarjeta | Medido en navegador |
| Tarjeta con 16 px laterales en móvil y máximo 24rem | ✅ | `login.astro:14` `p-4` (1rem = 16 px); `login.astro:15` `max-w-sm` → CSS `max-width: var(--container-sm)` = `24rem` | Verificado en CSS generado y medición a 320 px |
| A 768 y 1440 px centrada y mismo ancho máximo | ✅ | Playwright: 768 px → tarjeta x=192, ancho 384; 1440 px → x=528, ancho 384; error de centrado 0 en ambos | Medido en navegador |
| Inputs y botón a todo el ancho de la tarjeta | ✅ | `login.astro:21,25,30` usan `w-full`; a 320 px los tres miden 240 px, todo el ancho útil de la tarjeta | Verificado en navegador |
| A 568×320 scroll vertical sin recortes | ✅ | Playwright a 568×320: `scrollHeight` 370 > `clientHeight` 320; `body`/`main` con `overflow: visible`; tarjeta de y=16 a 354, dentro del documento; sin scroll horizontal | Medido en navegador |
| `prefers-color-scheme` light → `dona`; dark → `dona-dark` | ✅ | Playwright con `emulateMedia`: light → `--color-base-100: oklch(0.99 0.005 22)` y `primary: oklch(0.48 0.19 22)`; dark → `base-100: oklch(0.2 0.015 22)` y `primary: oklch(0.62 0.2 22)` | Coincide con `global.css:6-84` (`default`/`prefersdark`) |
| Contraste ≥ 4.5:1 en base-100, base-200 y btn-primary | ✅ | WCAG calculado sobre colores renderizados: claro 16.87:1, 15.69:1 y 6.8:1; oscuro 15.67:1, 16.74:1 y 4.93:1 | `base-content` sobre `base-100`/`base-200` y `primary-content` sobre `primary` |
| Sin errores en consola | ✅ | Playwright: 0 errores y 0 warnings durante carga, envío válido y envío vacío | Observado en navegador |
| Sin texto del starter de Astro | ✅ | `src/` solo contiene `pages/auth/login.astro`; `grep` de «Welcome/Astro/Hello» sin coincidencias; `src/pages/index.astro` no existe | El HTML servido solo contiene el contenido del login |
