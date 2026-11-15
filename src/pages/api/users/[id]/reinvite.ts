import type { APIRoute } from 'astro';
import { sendInviteEmail } from '../../../../features/invitations/lib/email';
import { generateInviteLink } from '../../../../features/invitations/lib/invitations';
import { findUserProfile, isUserId } from '../../../../features/users/lib/users-admin';

const NOT_FOUND_ERROR = 'No se encontró el usuario.';
const ALREADY_CONFIRMED_ERROR = 'Esta cuenta ya validó su correo.';
const RESEND_ERROR = 'No se pudo reenviar la invitación.';

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

export const POST: APIRoute = async ({ request, params, locals }) => {
  // La sesión viene de getClaims() ejecutado en el middleware.
  if (!locals.claims) {
    return json(401, { error: 'No autorizado.' });
  }

  // El middleware ya resolvió la fila del solicitante y su rol.
  if (locals.currentUser?.rol !== 'admin') {
    return json(403, { error: 'Se requiere rol de administrador.' });
  }

  const id = params.id ?? '';
  if (!isUserId(id)) {
    return json(404, { error: NOT_FOUND_ERROR });
  }

  const found = await findUserProfile(id);
  if (!found.ok) {
    console.error('[api/users] no se pudo leer el perfil:', found.error);
    return json(500, { error: RESEND_ERROR });
  }
  if (!found.profile) {
    return json(404, { error: NOT_FOUND_ERROR });
  }

  const profile = found.profile;

  // Una cuenta confirmada ya no tiene una invitación pendiente: es recuperación de contraseña.
  if (profile.email_confirmado) {
    return json(409, { error: ALREADY_CONFIRMED_ERROR });
  }

  const link = await generateInviteLink(profile.email);
  if (!link.ok) {
    // GoTrue responde email_exists si la cuenta ya está confirmada.
    if (link.reason === 'exists') {
      return json(409, { error: ALREADY_CONFIRMED_ERROR });
    }
    return json(500, { error: RESEND_ERROR });
  }

  try {
    await sendInviteEmail({
      origin: new URL(request.url).origin,
      email: profile.email,
      nombre: profile.nombre,
      tokenHash: link.tokenHash
    });
  } catch (smtpError) {
    console.error('[api/users] fallo SMTP:', smtpError);
    return json(500, { error: RESEND_ERROR });
  }

  return json(200, { ok: true });
};

export const ALL: APIRoute = () =>
  new Response(null, { status: 405, headers: { Allow: 'POST' } });
