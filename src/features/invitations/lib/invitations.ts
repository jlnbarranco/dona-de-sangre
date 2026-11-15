import { ROL_VALUES, type Rol } from '../../../lib/roles';
import { createSupabaseAdminClient } from './supabase-admin';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NOMBRE_MAX_LENGTH = 120;
const DEFAULT_ROL: Rol = 'capturador';
const GENERIC_INVITE_ERROR = 'No se pudo generar la invitación.';
const PROFILE_ERROR = 'No se pudo guardar el perfil del usuario.';

export interface InviteInput {
  email: string;
  nombre: string;
  rol: Rol;
}

export type ParseInviteResult =
  | { ok: true; input: InviteInput }
  | { ok: false; error: string };

export type CreateInvitedUserResult =
  | { ok: true; input: InviteInput; tokenHash: string }
  | { ok: false; reason: 'exists' | 'failed'; error: string };

export type GenerateInviteLinkResult =
  | { ok: true; userId: string; tokenHash: string }
  | { ok: false; reason: 'exists' | 'failed'; error: string };

function isRol(value: string): value is Rol {
  return ROL_VALUES.some((rol) => rol === value);
}

/**
 * Genera el enlace de invitación con GoTrue. Si la cuenta ya existe y está
 * confirmada, GoTrue responde `email_exists`; si existe sin confirmar,
 * renueva su token y conserva el mismo `id`.
 */
export async function generateInviteLink(email: string): Promise<GenerateInviteLinkResult> {
  const admin = createSupabaseAdminClient();

  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: 'invite',
    email
  });

  if (linkError || !link?.properties.hashed_token || !link.user?.id) {
    if (linkError?.code === 'email_exists') {
      // Mensaje genérico: no se filtra el detalle de Supabase
      return { ok: false, reason: 'exists', error: GENERIC_INVITE_ERROR };
    }
    console.error('[invitations] generateLink falló:', linkError?.message ?? linkError);
    return { ok: false, reason: 'failed', error: GENERIC_INVITE_ERROR };
  }

  return { ok: true, userId: link.user.id, tokenHash: link.properties.hashed_token };
}

/** Valida y normaliza el cuerpo de la petición de invitación. */
export function parseInviteInput(body: unknown): ParseInviteResult {
  const payload = (body ?? {}) as Record<string, unknown>;

  const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
  if (!EMAIL_PATTERN.test(email)) {
    return { ok: false, error: 'Correo electrónico no válido.' };
  }

  const rawNombre = typeof payload.nombre === 'string' ? payload.nombre.trim() : undefined;
  if (rawNombre !== undefined && rawNombre.length > NOMBRE_MAX_LENGTH) {
    return { ok: false, error: `El nombre no puede superar los ${NOMBRE_MAX_LENGTH} caracteres.` };
  }

  const rawRol = payload.rol;
  const rol = rawRol === undefined || rawRol === null ? DEFAULT_ROL : rawRol;
  if (typeof rol !== 'string' || !isRol(rol)) {
    return { ok: false, error: 'Rol no válido.' };
  }

  return {
    ok: true,
    input: {
      email,
      // Sin nombre se usa la parte local del correo, igual que hace el trigger.
      nombre: rawNombre ? rawNombre : email.split('@')[0],
      rol
    }
  };
}

/**
 * Crea el usuario invitado y guarda su nombre y rol en `public.usuarios`.
 * Si la escritura del perfil falla, borra el usuario recién creado para no
 * dejar cuentas a medias que el admin no puede arreglar desde la aplicación.
 */
export async function createInvitedUser(input: InviteInput): Promise<CreateInvitedUserResult> {
  const admin = createSupabaseAdminClient();

  const link = await generateInviteLink(input.email);
  if (!link.ok) {
    return { ok: false, reason: link.reason, error: link.error };
  }

  const { error: profileError } = await admin
    .from('usuarios')
    .update({ nombre: input.nombre, rol: input.rol })
    .eq('id', link.userId);

  if (profileError) {
    console.error('[invitations] no se pudo guardar el perfil:', profileError.message);
    const { error: deleteError } = await admin.auth.admin.deleteUser(link.userId);
    if (deleteError) {
      console.error('[invitations] no se pudo borrar el usuario tras el fallo del perfil:', deleteError.message);
    }
    return { ok: false, reason: 'failed', error: PROFILE_ERROR };
  }

  return { ok: true, input, tokenHash: link.tokenHash };
}
