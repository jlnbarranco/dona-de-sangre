import type { APIRoute } from 'astro';
import {
  deleteUserAccount,
  isUserId,
  parseUserUpdateInput,
  updateUserProfile
} from '../../../features/users/lib/users-admin';

const NOT_FOUND_ERROR = 'No se encontró el usuario.';

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

export const PATCH: APIRoute = async ({ request, params, locals }) => {
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

  const body = await request.json().catch(() => null);
  const parsed = parseUserUpdateInput(body);
  if (!parsed.ok) {
    return json(400, { error: parsed.error });
  }

  // Autoprotección: nadie cambia su propio rol ni su propio estatus.
  if (id === locals.claims.sub && (parsed.input.rol ?? parsed.input.estatus)) {
    return json(403, { error: 'No puedes cambiar tu propio rol ni tu estatus.' });
  }

  const updated = await updateUserProfile(id, parsed.input);
  if (!updated.ok) {
    if (updated.reason === 'not_found') {
      return json(404, { error: NOT_FOUND_ERROR });
    }
    console.error('[api/users] no se pudo guardar el cambio:', updated.error);
    return json(500, { error: 'No se pudo guardar el cambio.' });
  }

  return json(200, { ok: true });
};

export const DELETE: APIRoute = async ({ params, locals }) => {
  if (!locals.claims) {
    return json(401, { error: 'No autorizado.' });
  }

  if (locals.currentUser?.rol !== 'admin') {
    return json(403, { error: 'Se requiere rol de administrador.' });
  }

  const id = params.id ?? '';
  if (!isUserId(id)) {
    return json(404, { error: NOT_FOUND_ERROR });
  }

  // Nadie puede eliminarse a sí mismo: siempre queda al menos un admin.
  if (id === locals.claims.sub) {
    return json(403, { error: 'No puedes eliminar tu propia cuenta.' });
  }

  const deleted = await deleteUserAccount(id);
  if (!deleted.ok) {
    if (deleted.reason === 'not_found') {
      return json(404, { error: NOT_FOUND_ERROR });
    }
    console.error('[api/users] no se pudo eliminar el usuario:', deleted.error);
    return json(500, { error: 'No se pudo eliminar el usuario.' });
  }

  return json(200, { ok: true });
};

export const ALL: APIRoute = () =>
  new Response(null, { status: 405, headers: { Allow: 'PATCH, DELETE' } });
