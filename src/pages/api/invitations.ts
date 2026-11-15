import type { APIRoute } from 'astro';
import { sendInviteEmail } from '../../features/invitations/lib/email';
import { createInvitedUser, parseInviteInput } from '../../features/invitations/lib/invitations';

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

export const POST: APIRoute = async ({ request, locals }) => {
  // La sesión viene de getClaims() ejecutado en el middleware.
  if (!locals.claims) {
    return json(401, { error: 'No autorizado.' });
  }

  // El middleware ya resolvió la fila del solicitante y su rol.
  if (locals.currentUser?.rol !== 'admin') {
    return json(403, { error: 'Se requiere rol de administrador.' });
  }

  const body = await request.json().catch(() => null);
  const parsed = parseInviteInput(body);
  if (!parsed.ok) {
    return json(400, { error: parsed.error });
  }

  const created = await createInvitedUser(parsed.input);
  if (!created.ok) {
    return json(created.reason === 'exists' ? 409 : 500, { error: created.error });
  }

  try {
    await sendInviteEmail({
      origin: new URL(request.url).origin,
      email: parsed.input.email,
      nombre: parsed.input.nombre,
      tokenHash: created.tokenHash
    });
  } catch (smtpError) {
    // El usuario queda pendiente: el admin puede re-invitar el mismo correo
    console.error('[invitations] fallo SMTP:', smtpError);
    return json(500, { error: 'No se pudo enviar la invitación.' });
  }

  return json(200, { ok: true });
};

export const GET: APIRoute = () =>
  new Response(null, { status: 405, headers: { Allow: 'POST' } });
