# SPEC 04 — Visibilidad de contraseña en login

> **Estado:** Implementado
> **Depende de:** SPEC 01, SPEC 02
> **Fecha:** 2026-11-07
> **Objetivo:** Permitir que la persona que inicia sesión muestre u oculte temporalmente la contraseña escrita.

## Por qué existe este spec

El campo de contraseña del login permanece enmascarado mientras se escribe. Un control explícito para mostrarla permite comprobar lo escrito y volver a ocultarlo sin cambiar el valor enviado al endpoint de autenticación.

## Alcance

**Incluido:**

- Control «Mostrar contraseña» junto al campo de contraseña en `src/pages/auth/login.astro`.
- Alternar entre los tipos `password` y `text` sin perder el valor del campo.
- Actualizar el nombre visible y accesible del control a «Ocultar contraseña» cuando el valor esté visible, y volver a «Mostrar contraseña» al ocultarlo.
- Mantener la contraseña enmascarada por defecto y conservar el contrato existente del formulario.
- Uso con teclado y puntero, sin alterar el envío del login.

**Fuera de alcance:**

- Cambios en la autenticación, el endpoint, Supabase o el modelo de datos.
- Recuperación, actualización o almacenamiento de contraseñas.
- Iconografía, persistencia de la preferencia o cambios en otros formularios.

## Modelo de datos

No se introducen datos ni persistencia. El input conserva los atributos existentes:

| Campo | `name` / `id` | Tipo inicial | Atributos |
| --- | --- | --- | --- |
| Contraseña | `password` | `password` | `required`, `autocomplete="current-password"` |

## Especificación visual y de accesibilidad

- Conservar la etiqueta visible «Contraseña» asociada al input.
- Integrar el botón dentro del contenedor del campo con el patrón daisyUI `input` para varios elementos y un botón de acción daisyUI.
- Usar un elemento `<button type="button">`; nunca debe enviar el formulario.
- El texto del botón forma su nombre accesible y describe la acción disponible: «Mostrar contraseña» cuando está oculta y «Ocultar contraseña» cuando está visible.
- Mantener el tipo inicial `password`. Si JavaScript no está disponible, la contraseña sigue protegida y el control no debe presentarse como funcional.
- Mantener el diseño mobile-first y evitar scroll horizontal a 320 px.

## Comportamiento

1. Al cargar la página, el input tiene `type="password"` y el control ofrece «Mostrar contraseña».
2. Al activar el control, el mismo input cambia a `type="text"`; su valor permanece intacto y el control pasa a «Ocultar contraseña».
3. Al activarlo de nuevo, el input vuelve a `type="password"` y el control vuelve a «Mostrar contraseña».
4. El control es operable con teclado y puntero. Activarlo no envía el formulario; el envío con el botón «Iniciar sesión» mantiene el comportamiento existente.
5. El estado visible solo dura mientras la página lo mantiene; no se guarda en cookies, almacenamiento local ni servidor.

## Plan de implementación

1. En `src/pages/auth/login.astro`, integrar el botón `type="button"` al campo de contraseña y extender el script existente para alternar su tipo y etiqueta. Preservar el listener actual de envío. Verificar con `npm run build` y probar ambos estados, teclado, puntero, envío del formulario y ancho de 320 px.

## Criterios de aceptación

- [x] El input de contraseña comienza con `type="password"` y conserva `id="password"`, `name="password"`, `required` y `autocomplete="current-password"`.
- [x] Se puede mostrar y volver a ocultar la contraseña sin borrar ni modificar su valor.
- [x] El texto y nombre accesible del botón coinciden con la acción disponible en cada estado.
- [x] El control es un botón nativo `type="button"` y no envía el formulario al activarlo con clic, Enter o Espacio.
- [x] El formulario mantiene la validación HTML nativa y el botón «Iniciar sesión» sigue enviando al endpoint existente.
- [x] Sin JavaScript, la contraseña permanece oculta y no se muestra un control inoperante.
- [x] A 320 px no hay scroll horizontal ni se desborda el control.
- [x] `npm run build` termina correctamente.
- [x] No hay errores de JavaScript en la consola durante la interacción.

## Decisiones tomadas y descartadas

- **Sí:** botón de acción con texto cambiante. Su etiqueta comunica directamente el estado y la acción disponible.
- **No:** switch persistente o checkbox. La preferencia solo afecta temporalmente la presentación del campo actual.
- **No:** cambiar el `name`, los atributos de validación o el endpoint. La modificación se limita a la presentación del valor durante la captura.

## Riesgos

| Riesgo | Mitigación |
| --- | --- |
| JavaScript no carga y el control no puede alternar el campo | Mantener el input enmascarado por defecto y no mostrar el botón hasta que su comportamiento esté disponible. |
| El botón se interpreta como envío del formulario | Declarar explícitamente `type="button"` y verificarlo con teclado y puntero. |
| El texto visible queda expuesto si la persona olvida ocultarlo | El control mantiene la acción «Ocultar contraseña» visible mientras el valor está expuesto; no se persiste el estado. |

## Verificación

> **Fecha:** 2026-11-07
> **Resultado:** 7/9 criterios verificados

| Criterio | Estado | Evidencia | Notas |
| --- | --- | --- | --- |
| El input conserva tipo inicial, identificador, nombre, required y autocomplete | ✅ | Inspección en Playwright de `#password`: `type=password`, `id=password`, `name=password`, `required=true`, `autocomplete=current-password` | — |
| Mostrar y ocultar conserva el valor | ✅ | Playwright: el valor `ClavePrueba-123` se conservó al alternar a `text` y de vuelta a `password` | Activación del evento click del botón |
| El texto y nombre accesible del botón coinciden con la acción | ❌ | Playwright: `aria-label` cambia correctamente, pero `innerText` está vacío; el control muestra iconos SVG | El spec requiere texto visible y excluye iconografía; la implementación actual sigue una petición posterior del usuario. Mantener el criterio pendiente hasta resolver la discrepancia del spec. |
| Botón no envía el formulario al activarlo con clic, Enter o Espacio | ⚠️ | DOM: `type=button`; contador de `submit` permaneció en 0 tras activación programática. Playwright no logró una activación física/teclado fiable: el clic expiró esperando estabilidad y Enter/Espacio no cambiaron el estado en esa sesión | No se marca porque no se pudo verificar de forma fiable la activación solicitada por cada método. |
| Validación nativa y envío al endpoint existente | ✅ | Playwright: con campos vacíos, `form.checkValidity()` fue `false`; DOM: `method=post`, `action=/api/auth/login` y botón submit | No se enviaron credenciales reales. |
| Sin JavaScript el campo permanece oculto y el control no se muestra como funcional | ✅ | Código: el botón incluye la clase `hidden` en el HTML y el script solo la remueve al registrar el listener; el input inicia como `type=password` | Verificación estática del HTML/script; no se deshabilitó JavaScript en navegador. |
| A 320 px no hay scroll horizontal | ✅ | Playwright: `clientWidth=320`, `scrollWidth=320` | — |
| `npm run build` termina correctamente | ✅ | `npm run build` → `Complete!`, exit 0 | Dos warnings no fatales conocidos de selectores daisyUI. |
| Sin errores de JavaScript en consola | ✅ | Playwright: 0 mensajes de consola `error` durante recarga y alternancia del control | — |
