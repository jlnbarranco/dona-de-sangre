import type { Database } from '../../../lib/database.types';
import { ESTATUS_VALUES, type Estatus } from '../../../lib/estatus';
import { ROL_VALUES, type Rol } from '../../../lib/roles';
import { createSupabaseAdminClient } from '../../invitations/lib/supabase-admin';

const NOMBRE_MAX_LENGTH = 120;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type UserProfile = {
  id: string;
  nombre: string;
  email: string;
  rol: Rol;
  estatus: Estatus;
  email_confirmado: boolean;
  invitado_at: string | null;
};

export type UserUpdateInput = {
  nombre: string;
  rol?: Rol;
  estatus?: Estatus;
};

export type ParseUserUpdateResult =
  | { ok: true; input: UserUpdateInput }
  | { ok: false; error: string };

export type FindUserProfileResult =
  | { ok: true; profile: UserProfile | null }
  | { ok: false; error: string };

export type WriteUserResult =
  | { ok: true }
  | { ok: false; reason: 'not_found' | 'failed'; error: string };

function isRol(value: string): value is Rol {
  return ROL_VALUES.some((rol) => rol === value);
}

function isEstatus(value: string): value is Estatus {
  return ESTATUS_VALUES.some((estatus) => estatus === value);
}

/** El id de la ruta debe ser el UUID de `public.usuarios` (el de `auth.users`). */
export function isUserId(id: string): boolean {
  return UUID_PATTERN.test(id);
}

/**
 * Valida el cuerpo del PATCH: el nombre es obligatorio (1-120 caracteres) y
 * el rol y el estatus son opcionales, pero siempre dentro de su lista blanca.
 * Los campos desconocidos se ignoran: el correo no se puede editar.
 */
export function parseUserUpdateInput(body: unknown): ParseUserUpdateResult {
  const payload = (body ?? {}) as Record<string, unknown>;

  const nombre = typeof payload.nombre === 'string' ? payload.nombre.trim() : '';
  if (!nombre) {
    return { ok: false, error: 'El nombre es obligatorio.' };
  }
  if (nombre.length > NOMBRE_MAX_LENGTH) {
    return { ok: false, error: `El nombre no puede superar los ${NOMBRE_MAX_LENGTH} caracteres.` };
  }

  const input: UserUpdateInput = { nombre };

  if (payload.rol !== undefined && payload.rol !== null) {
    if (typeof payload.rol !== 'string' || !isRol(payload.rol)) {
      return { ok: false, error: 'Rol no válido.' };
    }
    input.rol = payload.rol;
  }

  if (payload.estatus !== undefined && payload.estatus !== null) {
    if (typeof payload.estatus !== 'string' || !isEstatus(payload.estatus)) {
      return { ok: false, error: 'Estatus no válido.' };
    }
    input.estatus = payload.estatus;
  }

  return { ok: true, input };
}

/** Lee el perfil con clave secreta: la lectura no depende de las políticas de RLS. */
export async function findUserProfile(id: string): Promise<FindUserProfileResult> {
  const admin = createSupabaseAdminClient();

  const { data, error } = await admin
    .from('usuarios')
    .select('id, nombre, email, rol, estatus, email_confirmado, invitado_at')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    return { ok: false, error: error.message };
  }

  return { ok: true, profile: data };
}

/**
 * Escribe nombre, rol y estatus del perfil. El cambio de estatus dispara el
 * trigger que mantiene `auth.users.banned_until` sincronizado.
 */
export async function updateUserProfile(id: string, input: UserUpdateInput): Promise<WriteUserResult> {
  const admin = createSupabaseAdminClient();

  const changes: Database['public']['Tables']['usuarios']['Update'] = { nombre: input.nombre };
  if (input.rol) {
    changes.rol = input.rol;
  }
  if (input.estatus) {
    changes.estatus = input.estatus;
  }

  const { data, error } = await admin
    .from('usuarios')
    .update(changes)
    .eq('id', id)
    .select('id')
    .maybeSingle();

  if (error) {
    return { ok: false, reason: 'failed', error: error.message };
  }
  if (!data) {
    return { ok: false, reason: 'not_found', error: 'El usuario no existe.' };
  }

  return { ok: true };
}

/**
 * Borra la cuenta en Auth. La fila de `public.usuarios` cae en cascada por la
 * clave foránea `on delete cascade`.
 */
export async function deleteUserAccount(id: string): Promise<WriteUserResult> {
  const admin = createSupabaseAdminClient();

  const { error } = await admin.auth.admin.deleteUser(id);

  if (error) {
    return {
      ok: false,
      reason: error.status === 404 ? 'not_found' : 'failed',
      error: error.message
    };
  }

  return { ok: true };
}
