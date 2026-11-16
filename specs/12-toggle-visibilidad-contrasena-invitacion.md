# SPEC 12 — Visibilidad de contraseña al aceptar la invitación

> **Estado:** Aprobado
> **Depende de:** SPEC 02, SPEC 03, SPEC 04, SPEC 05
> **Fecha:** 2026-11-15
> **Objetivo:** que al aceptar la invitación y elegir la contraseña, cada campo de `/auth/update-password` tenga su propio control de ojo para mostrar u ocultar temporalmente lo escrito, sin cambiar el valor que se envía a Supabase.

## Por qué existe este spec

El flujo de invitación termina en `/auth/update-password` (SPEC 03), donde la persona define su contraseña por primera vez. Los dos campos de esa pantalla permanecen enmascarados mientras se escriben y no ofrecen ninguna forma de comprobar lo tecleado.

SPEC 04 ya añadió un control «Mostrar contraseña» en el login y SPEC 05 lo extrajo a `src/features/auth/components/PasswordInput.astro`. Sin embargo, ese componente nace atado al login: fija `id="password"`, `name="password"` y `autocomplete="current-password"` en el marcado, y su `<script>` resuelve el input y el botón con `document.getElementById('password')` y `getElementById('password-toggle')`. Por eso no puede usarse dos veces en la misma página: duplicaría `id`s y el script solo cablearía una de las dos instancias.

Este spec generaliza `PasswordInput` (props + script por instancia) y lo reutiliza en los dos campos de la pantalla de la invitación. No toca la autenticación, el endpoint ni el modelo de datos: es un cambio de presentación durante la captura.

## Alcance

**Incluido:**

- `src/features/auth/components/PasswordInput.astro` deja de estar atado al login: recibe por props lo que hoy tiene fijo y su script funciona con varias instancias en la misma página.
- Ojo de mostrar/ocultar en **los dos** campos de `src/pages/auth/update-password.astro` (contraseña y confirmación), cada uno independiente del otro.
- Nombre accesible distinto por campo: «Mostrar contraseña» / «Mostrar confirmación de contraseña» (y sus pares «Ocultar …»).
- Iconos migrados a `Eye` / `EyeOff` de `@lucide/astro`, en línea con la convención del proyecto (los iconos vienen de Lucide, no de SVG en línea).
- Adaptar `src/pages/auth/login.astro` a la firma nueva del componente, conservando su comportamiento y su contrato de formulario.
- Verificación con `npm run build`, `npx tsc --noEmit`, `npm run check` y Playwright.

**Fuera de alcance:**

- Cambios en la autenticación, en `POST /auth/update-password`, en `updateUser` o en el endpoint del login.
- Supabase: sin tablas, columnas, políticas, triggers ni tipos generados.
- Cambios en la validación (`required`, `minlength`), en `autocomplete` o en el destino de los formularios.
- Persistencia de la preferencia (cookies, `localStorage`, servidor).
- Nuevos formularios con contraseña; el componente no se lleva a `dashboard` ni a otras pantallas.
- Cambios en `src/styles/global.css`, `astro.config.mjs`, `src/middleware.ts` o variables de entorno.
- Modificar `specs/04-toggle-visibilidad-contrasena.md` ni su estado.

## Modelo de datos

**No se introducen datos ni persistencia.** Los campos mantienen sus atributos actuales:

| Campo | Página | `name` / `id` | Tipo inicial | Atributos |
| --- | --- | --- | --- | --- |
| Contraseña | `/auth/update-password` | `password` | `password` | `required`, `minlength="8"`, `autocomplete="new-password"` |
| Confirmar contraseña | `/auth/update-password` | `password_confirm` | `password` | `required`, `minlength="8"`, `autocomplete="new-password"` |
| Contraseña | `/auth/login` | `password` | `password` | `required`, `autocomplete="current-password"` |

El valor visible solo dura mientras la página lo mantiene; no se guarda en cookies, almacenamiento local ni servidor.

## Especificación visual y de accesibilidad

### `PasswordInput.astro` (componente compartido)

- Raíz `<div class="input w-full" data-password-input>`, con el input `class="grow"` y un `<button type="button" class="btn btn-ghost btn-square btn-sm hidden">` de acción. Se conserva el patrón daisyUI `input` para varios elementos y el botón de acción.
- Props:

  | Prop | Tipo | Valor por defecto | Para qué |
  | --- | --- | --- | --- |
  | `id` | `string` (requerido) | — | `id` del input; debe coincidir con el `for` del `FormField` que lo envuelve |
  | `name` | `string` | `id` | `name` del input |
  | `autocomplete` | `string` | `current-password` | `current-password` en login, `new-password` en la invitación |
  | `required` | `boolean` | `false` | se propaga al input |
  | `minlength` | `number \| string` | — | se propaga al input |
  | `toggleLabel` | `string` | `contraseña` | sustantivo que completa el nombre accesible del botón |

- El botón incluye dos iconos de Lucide: `<Eye data-icon="eye" size={20} />` visible y `<EyeOff data-icon="eye-off" size={20} class="hidden" />` oculto. Lucide reenvía `class` y atributos `data-*`, y marca el SVG como decorativo (`aria-hidden`).
- El botón lleva `aria-label` con la acción disponible: «Mostrar {toggleLabel}» cuando la contraseña está oculta y «Ocultar {toggleLabel}» cuando está visible. `toggleLabel` por defecto produce «Mostrar contraseña» / «Ocultar contraseña»; en la confirmación se pasa `confirmación de contraseña` para distinguir los dos botones con un lector de pantalla.
- El botón arranca con la clase `hidden` en el HTML; solo el script la retira. Sin JavaScript, la contraseña sigue enmascarada y no se muestra un control inoperante.

### `/auth/update-password`

- Cada campo se compone con `FormField` (etiqueta visible asociada) y un `PasswordInput` con `id`/`name` iguales al del `FormField`:
  - «Contraseña» → `id="password"`, `toggleLabel` por defecto.
  - «Confirmar contraseña» → `id="password_confirm"`, `toggleLabel="confirmación de contraseña"`.
- Se conservan `required`, `minlength={8}` y `autocomplete="new-password"` en ambos campos, y el `<form>` con `method="post" action="/auth/update-password"`.
- El botón «Guardar contraseña» y su script de envío no cambian.

### `/auth/login`

- Mantiene `FormField id="password"` envolviendo `<PasswordInput id="password" required autocomplete="current-password" />`.
- El resultado servido sigue siendo equivalente: mismo `id`, `name`, `type`, `required`, `autocomplete` y el mismo comportamiento de mostrar/ocultar. El único cambio visible es que el SVG del ojo pasa a ser el de Lucide.

### Responsive

- Mobile-first; sin scroll horizontal a 320 px. El botón es cuadrado (`btn-square btn-sm`) y no desborda el contenedor `input`.

## Comportamiento

1. Al cargar cualquiera de las dos páginas, cada input tiene `type="password"` y cada botón ofrece «Mostrar …» con el icono `Eye`.
2. Al activar un botón, **solo su** input cambia a `type="text"`; su valor permanece intacto; su botón pasa a «Ocultar …» y muestra el icono `EyeOff`. El otro campo (en la invitación) no se altera.
3. Al activarlo de nuevo, ese input vuelve a `type="password"` y su botón a «Mostrar …» con `Eye`.
4. Los botones son `type="button"`: operables con teclado y puntero, y activarlos nunca envía el formulario. El envío con «Iniciar sesión» o «Guardar contraseña» conserva el comportamiento existente.
5. El script del componente se ejecuta una sola vez por página (Astro deduplica los `<script>` de componentes repetidos) y recorre todas las instancias con `document.querySelectorAll('[data-password-input]')`, resolviendo input, botón e iconos **dentro de cada instancia**. No usa `getElementById` ni `id`s globales para el toggle.
6. Sin JavaScript, los inputs permanecen enmascarados y los botones siguen ocultos (clase `hidden`), sin presentarse como funcionales.

## Estructura de archivos

```text
src/
├── features/
│   └── auth/
│       └── components/
│           └── PasswordInput.astro        # MODIFICADO: props + script por instancia + Lucide
└── pages/
    └── auth/
        ├── login.astro                    # MODIFICADO: pasa id/required/autocomplete al componente
        └── update-password.astro          # MODIFICADO: los dos campos usan FormField + PasswordInput
```

### Contrato de los archivos

| Archivo | Responsabilidad |
| --- | --- |
| `src/features/auth/components/PasswordInput.astro` | Campo de contraseña reutilizable: `div.input w-full` + input + botón de ojo con sus dos iconos y su script multi-instancia. Recibe `id`, `name`, `autocomplete`, `required`, `minlength` y `toggleLabel` por props. |
| `src/pages/auth/login.astro` | Envuelve `<PasswordInput id="password" required autocomplete="current-password" />` en `FormField`; conserva su script de envío. |
| `src/pages/auth/update-password.astro` | Compone los dos campos con `FormField` + `PasswordInput` y conserva validación, atributos y destino del formulario. |

### Por qué se generaliza el componente en vez de duplicar el toggle

SPEC 05 fijó «no dar props a `PasswordInput` que nadie consume hoy»; ese supuesto deja de cumplirse: ahora `id`, `name`, `autocomplete`, `required`, `minlength` y el nombre accesible **sí** varían entre el login y la invitación, y el componente debe convivir consigo mismo dos veces en una página. Duplicar el ojo y su script en `update-password.astro` repetiría el mismo marcado y la misma lógica en dos sitios (contra DRY) y dejaría dos implementaciones del control que habría que mantener en paralelo. Se generaliza el componente existente.

## Plan de implementación

1. Generalizar `src/features/auth/components/PasswordInput.astro`: añadir las props, marcar la raíz con `data-password-input`, reemplazar los SVG en línea por `Eye`/`EyeOff` de `@lucide/astro` y reescribir el script para recorrer todas las instancias con `querySelectorAll` y resolver input, botón e iconos dentro de cada una. Verificar con `npm run build` y `npm run check`.
2. Adaptar `src/pages/auth/login.astro` a la firma nueva: `<PasswordInput id="password" required autocomplete="current-password" />`. Verificar con `npm run build`, `npm run check` y Playwright que mostrar/ocultar sigue funcionando y que el `#password` conserva sus atributos.
3. Usar `FormField` + `PasswordInput` en los dos campos de `src/pages/auth/update-password.astro`, con `toggleLabel` distinto en la confirmación. Verificar con `npm run build`, `npx tsc --noEmit` y `npm run check`.
4. Verificar con Playwright en `/auth/update-password`: los dos toggles son independientes, conservan el valor, alternan `aria-label` e icono, no envían el formulario (clic, Enter y Espacio), los dos campos conservan `required`, `minlength="8"` y `autocomplete="new-password"`, sin scroll horizontal a 320 px y sin errores de consola.
5. Comprobar sin JavaScript (o con el script bloqueado) que los dos inputs siguen en `type="password"` y los dos botones permanecen ocultos.
6. Actualizar `AGENTS.md` (comentario de `PasswordInput` en el árbol de `src/`, contrato del componente y lista de specs 01–12) y `README.md` si la descripción del componente lo requiere.

## Criterios de aceptación

- [ ] `npm run build` termina correctamente (solo los avisos no fatales `Invalid empty selector` de daisyUI).
- [ ] `npx tsc --noEmit` no reporta errores.
- [ ] `npm run check` (`astro check`) no reporta errores en los `.astro`.
- [ ] En `/auth/update-password` hay **dos** controles de ojo, uno por campo.
- [ ] Activar el ojo de un campo cambia solo su `type` entre `password` y `text` y conserva su valor; el otro campo no cambia.
- [ ] Cada botón es un `<button type="button">` con `aria-label` que describe la acción disponible, y los dos nombres accesibles se distinguen entre sí («Mostrar contraseña» y «Mostrar confirmación de contraseña»).
- [ ] Activarlo con clic, Enter o Espacio no envía el formulario; «Guardar contraseña» y «Iniciar sesión» siguen enviando a sus destinos.
- [ ] `#password` y `#password_confirm` conservan `type="password"` inicial, `required`, `minlength="8"`, `autocomplete="new-password"` y el `<form>` mantiene `method="post" action="/auth/update-password"`.
- [ ] En `/auth/login`, `#password` conserva `type="password"` inicial, `id`, `name`, `required`, `autocomplete="current-password"` y el ojo sigue alternando el campo.
- [ ] Sin JavaScript, los dos campos de la invitación siguen enmascarados y los dos botones permanecen ocultos.
- [ ] No hay `id`s duplicados en el HTML de `/auth/update-password` y el script no depende de `getElementById` para el toggle.
- [ ] A 320 px no hay scroll horizontal en `/auth/login` ni en `/auth/update-password`.
- [ ] No hay errores de JavaScript en la consola durante la interacción en ninguna de las dos pantallas.
- [ ] `AGENTS.md` refleja el nuevo contrato de `PasswordInput` y la lista de specs 01–12.

## Decisiones tomadas y descartadas

- **Sí:** ojo en **los dos** campos de la invitación, independientes. Quien escribe la contraseña dos veces se equivoca en cualquiera de las dos; ocultar solo la primera obligaría a reescribir a ciegas la confirmación.
- **Sí:** generalizar `PasswordInput` con props en vez de duplicar el toggle. Es el punto de variación real (id, name, autocomplete, nombre accesible) y evita dos copias del mismo control.
- **Sí:** script multi-instancia con `document.querySelectorAll('[data-password-input]')` y búsqueda dentro de cada instancia. Astro deduplica el `<script>` de un componente repetido, así que un script de una sola instancia dejaría la segunda sin cablear; `getElementById` además exigiría `id`s únicos que el componente no puede garantizar.
- **Sí:** nombre accesible por campo (`toggleLabel`). Con dos botones idénticos en la misma página, un lector de pantalla no podría distinguirlos.
- **Sí:** iconos `Eye`/`EyeOff` de `@lucide/astro`. Es la convención declarada del proyecto; mantener SVG en línea en un componente que se reescribe sería dejar una excepción sin motivo.
- **Sí:** control solo-icono con `aria-label`. Formaliza la petición posterior del usuario y la implementación real de SPEC 04 (cuyo criterio de «texto visible» quedó sin verificar). No se reescribe SPEC 04 ni se cambia su estado: solo una persona lo mueve.
- **No:** un `<input type="checkbox">` o un switch persistente. La preferencia afecta solo a la presentación temporal del campo actual.
- **No:** tocar `name`, `required`, `minlength`, `autocomplete`, el `action` del formulario o `updateUser`. El cambio se limita a cómo se muestra el valor durante la captura.
- **No:** extraer un `PasswordField` que combine `FormField` + `PasswordInput`. `FormField` ya admite `slot`; envolverlo no ahorra marcado y añade una capa.

## Riesgos

| Riesgo | Mitigación |
| --- | --- |
| El script se ejecuta una sola vez y solo cablea el primer campo | Recorrer todas las instancias con `querySelectorAll('[data-password-input]')`; verificar en Playwright que los dos toggles funcionan de forma independiente. |
| Quedan dos elementos con el mismo `id` y el `label`/`for` apunta al equivocado | El `id` es una prop obligatoria distinta por campo y se comprueba que no haya `id`s duplicados en el HTML servido. |
| El botón se interpreta como envío del formulario | Declarar `type="button"` y verificarlo con clic, Enter y Espacio en los dos campos. |
| El valor visible queda expuesto si la persona olvida ocultarlo | El botón mantiene la acción «Ocultar …» visible mientras el valor está expuesto; el estado no se persiste. |
| La migración a Lucide cambia el HTML de `/auth/login` | Es un cambio de presentación aceptado; se verifica que `#password` conserva tipo, `id`, `name`, `required` y `autocomplete` y que el toggle sigue funcionando. |
| Un `minlength`/`required` que se pierde al pasar por props | Se verifican los atributos de los tres campos en el HTML servido y el envío del formulario. |

## Qué **no** entra en este spec

- Autenticación, endpoint `POST /auth/update-password`, `updateUser` o `POST /api/auth/login`.
- Esquema de Supabase, migraciones, RLS, triggers o tipos generados.
- Validación, `minlength`, `autocomplete` o destino de los formularios.
- Persistencia de la preferencia de visibilidad.
- Otros formularios con contraseña fuera de `/auth/login` y `/auth/update-password`.
- `src/styles/global.css`, `astro.config.mjs`, `src/middleware.ts` o variables de entorno.
- El estado de `specs/04-toggle-visibilidad-contrasena.md`.
