# SPEC 03 — Invitación, confirmación de correo y contraseña propia

> **Estado:** Borrador
> **Depende de:** SPEC 02
> **Fecha:** 2026-11-07
> **Objetivo:** Permitir que un administrador invite cuentas desde Supabase y que el usuario confirme el correo y defina su propia contraseña antes de entrar al dashboard.

## Por qué existe este spec

SPEC 02 deja el login funcionando, pero asume cuentas ya confirmadas con contraseña conocida. El producto no tiene registro público: las cuentas las crea el laboratorio.

Este spec cierra el alta real. El admin invita desde el Dashboard de Supabase, el usuario recibe un correo, confirma el enlace y define su contraseña sin que el admin llegue a conocerla. Al terminar, el flujo completo queda: invitar → confirmar → elegir contraseña → entrar.

## Alcance

**Incluido:**

- Plantilla «Invite user» del Dashboard apuntando a `/auth/confirm` con `token_hash`, `type` y `next`.
- Ruta `GET /auth/confirm` que verifica el token con `verifyOtp` y redirige.
- Ruta `GET /auth/update-password` con el formulario de contraseña nueva.
- Ruta `POST /auth/update-password` que valida, llama a `updateUser` y redirige a `/dashboard`.
- Configuración del proyecto Supabase: Site URL, Redirect URLs permitidas, mínimo de contraseña y flujo de invitación.
- Estados de error para enlace inválido, caducado o ya usado.
- Documentación del límite del SMTP integrado y del reenvío manual de invitaciones.

**Fuera de alcance (para specs futuros):**

- Registro público `/auth/register`.
- Recuperación de contraseña («¿Olvidaste tu contraseña?»).
- Panel administrativo para invitar o reenviar desde la aplicación.
- Endpoint o UI de reenvío de invitación.
- SMTP propio (Resend, SendGrid, etc.).
- Emails con diseño propio más allá de una plantilla mínima en texto/HTML.
- MFA, OAuth, magic links y enlaces de un solo uso para login.
- Cambio de correo o de contraseña desde la aplicación.

## Modelo de datos

Este spec no introduce estructuras de datos nuevas. Reutiliza:

- `auth.users`, donde Supabase guarda el usuario y la contraseña hasheada.
- `public.usuarios` de SPEC 02, que recibe la fila por el trigger de alta con `rol = 'capturador'`.
- La sesión en cookies creada por el middleware de SPEC 02.

Parámetros de la ruta de confirmación:

| Parámetro    | Origen                       | Uso                                                     |
| ------------ | ---------------------------- | ------------------------------------------------------- |
| `token_hash` | Plantilla del correo         | Token que consume `verifyOtp`                           |
| `type`       | Plantilla del correo         | `invite` en este flujo                                  |
| `next`       | Plantilla del correo         | Ruta interna destino; por defecto `/auth/update-password` |

Reglas de `next`:

- Solo se acepta si empieza por `/` y no empieza por `//`.
- Cualquier otro valor cae al destino por defecto.
- Nunca se acepta una URL absoluta, aunque venga del propio correo.

## Plan de implementación

1. Configurar Supabase Auth en el Dashboard: Site URL con la URL de producción, Redirect URLs con `http://localhost:4321/**` y el dominio de Netlify, mínimo de contraseña de 8 caracteres y «Confirm email» activo. Verificar que el proyecto rechaza una contraseña de 7 caracteres.
2. Sustituir la plantilla «Invite user» por una que apunte a `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite&next=/auth/update-password`, con `{{ .Email }}` en el cuerpo y sin contraseñas. Verificar enviando una invitación de prueba y revisando el enlace recibido.
3. Crear `GET /auth/confirm`: lee `token_hash`, `type` y `next`, valida `next`, llama a `verifyOtp` y redirige al destino o a `/auth/login?error=link_invalido`. Verificar con un enlace real y con uno manipulado.
4. Crear `GET /auth/update-password`: si no hay sesión, redirige a `/auth/login`; si hay sesión, muestra el formulario con contraseña y confirmación. Verificar ambos casos.
5. Crear `POST /auth/update-password`: valida longitud mínima, coincidencia y que la sesión exista; llama a `updateUser({ password })` y redirige a `/dashboard`. En error, vuelve al formulario con mensaje visible. Verificar el alta completa de una cuenta.
6. Añadir los estados de error de `/auth/confirm` y `/auth/update-password` reutilizando el patrón visual de SPEC 01, con un enlace a `/auth/login`. Verificar enlace caducado, ya usado y token inválido.
7. Documentar en `AGENTS.md` y en el propio spec el límite de 2 correos por hora del SMTP integrado, la caducidad de la invitación y que el reenvío se hace desde el Dashboard. Verificar que el repositorio no contiene credenciales SMTP.

## Criterios de aceptación

- [ ] La plantilla «Invite user» del proyecto usa `{{ .TokenHash }}` y apunta a `/auth/confirm`.
- [ ] El correo de invitación no contiene ninguna contraseña ni enlace a una pantalla que la muestre.
- [ ] Invitar a un correo desde el Dashboard crea la fila en `usuarios` con `rol = 'capturador'`.
- [ ] Abrir el enlace de invitación crea cookies de sesión y redirige a `/auth/update-password`.
- [ ] `/auth/update-password` sin sesión redirige a `/auth/login`.
- [ ] Una contraseña de menos de 8 caracteres muestra un error y no llama a Supabase.
- [ ] Dos contraseñas distintas muestran un error y no llaman a Supabase.
- [ ] Una contraseña válida actualiza la cuenta, redirige a `/dashboard` y deja la sesión activa.
- [ ] Después de definir la contraseña, el usuario puede cerrar sesión y volver a entrar con esa contraseña.
- [ ] Reabrir el mismo enlace de invitación muestra un error de enlace inválido o caducado.
- [ ] Un enlace con `token_hash` inventado muestra un error y no crea sesión.
- [ ] Un `next` con `https://ejemplo.com` o `//ejemplo.com` se ignora y se usa `/auth/update-password`.
- [ ] El enlace caducado muestra un texto que explica que debe pedir una nueva invitación.
- [ ] Ningún error de este flujo revela si el correo existe en el sistema.
- [ ] El flujo completo funciona a 320 px de ancho, sin scroll horizontal.
- [ ] No hay errores en la consola del navegador en confirmación, formulario y error.
- [ ] El repositorio no contiene credenciales SMTP ni la clave `service_role`.

## Decisiones tomadas y descartadas

- **Sí:** `token_hash` + `verifyOtp` en una ruta de servidor. Funciona con cookies y evita depender del fragmento de URL del flujo implícito.
- **No:** `{{ .ConfirmationURL }}` del flujo implícito. El token viaja en el hash y no llega al servidor, justo lo que SPEC 02 necesita.
- **Sí:** invitación desde el Dashboard de Supabase. No hace falta panel ni endpoint de alta todavía.
- **No:** contraseña temporal creada por el admin. El admin conocería la contraseña y habría que forzar un cambio después.
- **Sí:** pantalla dedicada `/auth/update-password`. El usuario entiende qué está pasando y puede corregir errores.
- **Sí:** mínimo de 8 caracteres en el formulario y en la configuración del proyecto. La validación del cliente da feedback y la del servidor es la que cuenta.
- **Sí:** reenvío manual solo desde el Dashboard. Un endpoint público de reenvío añade superficie de abuso y necesita rate limit propio.
- **Sí:** SMTP integrado de Supabase para desarrollo. No exige credenciales externas; el límite de 2 correos por hora es aceptable mientras no haya usuarios reales.
- **No:** SMTP propio en este spec. Añade cuentas, credenciales y verificación de dominio; va aparte cuando haya despliegue real.
- **Sí:** errores genéricos. El flujo no debe servir para averiguar qué correos están registrados.
- **No:** reenviar la invitación automáticamente cuando caduca. La caducidad por defecto es de 1 hora y el admin decide.
- **No:** magic link para entrar sin contraseña. El producto pide contraseña propia para operar.

## Riesgos

| Riesgo                                                        | Mitigación                                                                                                   |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| El SMTP integrado limita a 2 correos por hora                 | Documentarlo; usar SMTP propio antes de dar de alta usuarios reales.                                         |
| Los correos pueden caer en spam                               | Avisar al admin al invitar y verificar la entrega con la primera cuenta real.                                |
| Un antivirus o «Safe Links» consume el enlace antes que el usuario | Reenviar la invitación desde el Dashboard y documentar el caso.                                          |
| La invitación caduca en 1 hora                                | Añadir el texto de «solicita una nueva invitación» en el error y no guardar tokens en el cliente.            |
| Una plantilla antigua con `{{ .ConfirmationURL }}` rompe el flujo | Revisar la plantilla antes del primer envío y dejarla escrita en `AGENTS.md`.                             |
| `verifyOtp` deja sesión abierta en un navegador compartido     | Recordar en el dashboard que la sesión se cierra con el botón de salir; no se añade expiración extra.        |
| El enlace se abre en otro navegador distinto del que lo pidió  | El flujo no depende del navegador de origen: el token crea la sesión donde se abre.                          |
| El usuario define la contraseña pero no recuerda el correo usado | El correo de invitación muestra `{{ .Email }}` y el login no revela si existe; soporte lo revisa a mano.    |

## Qué **no** entra en este spec

- Registro público y autogestión de cuenta.
- Recuperación de contraseña olvidada.
- Panel administrativo de invitaciones y reenvíos.
- Endpoint o enlace público de reenvío.
- SMTP propio, verificación de dominio y plantillas con diseño.
- MFA, OAuth y magic links.
- Cambio de correo o contraseña desde la aplicación.

Cada uno de esos puntos, si llega, va en su propio spec.
