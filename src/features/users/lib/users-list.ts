import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../../lib/database.types';
import { ESTATUS_VALUES, type Estatus } from '../../../lib/estatus';
import type { Rol } from '../../../lib/roles';

export const USERS_PER_PAGE = 10;

const MAX_SEARCH_LENGTH = 100;
const PAGE_WINDOW_SIZE = 5;
const DISALLOWED_SEARCH_CHARS = /[^\p{L}\p{N} @.\-_]/gu;

export type UsuarioListItem = {
  id: string;
  nombre: string;
  email: string;
  rol: Rol;
  estatus: Estatus;
  email_confirmado: boolean;
  invitado_at: string | null;
};

export type UsersListResult = {
  usuarios: UsuarioListItem[];
  total: number;
  page: number;
  totalPages: number;
  search: string;
  estatus: Estatus | null;
};

/**
 * Convierte el término escrito por el usuario en algo seguro de interpolar
 * en el filtro de PostgREST: solo letras, dígitos, espacio y `@ . - _`.
 * El guion bajo se escapa para que no actúe como comodín en `ILIKE`.
 */
export function sanitizeSearchTerm(raw: string): string {
  return raw
    .normalize('NFC')
    .replace(DISALLOWED_SEARCH_CHARS, ' ')
    .replace(/_/g, '\\_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_SEARCH_LENGTH);
}

/** Filtro de PostgREST: único punto donde se construye la condición de búsqueda. */
function buildSearchFilter(search: string): string | null {
  if (!search) {
    return null;
  }

  return `nombre.ilike.*${search}*,email.ilike.*${search}*`;
}

/**
 * Filtro de estatus: lista blanca. Cualquier valor que no sea `activo` o
 * `inactivo` se trata como «Todos».
 */
export function sanitizeEstatusFilter(raw: string): Estatus | null {
  const value = raw.trim().toLowerCase();

  return ESTATUS_VALUES.find((estatus) => estatus === value) ?? null;
}

/** Número de páginas que se muestran como enlaces, centrado en la actual. */
export function buildPageWindow(page: number, totalPages: number, size = PAGE_WINDOW_SIZE): number[] {
  if (totalPages <= 0) {
    return [];
  }

  if (totalPages <= size) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  const half = Math.floor(size / 2);
  const start = Math.min(Math.max(page - half, 1), totalPages - size + 1);

  return Array.from({ length: size }, (_, index) => start + index);
}

function clampPage(page: number, totalPages: number): number {
  if (!Number.isFinite(page)) {
    return 1;
  }

  return Math.min(Math.max(Math.trunc(page), 1), Math.max(totalPages, 1));
}

/** Total de filas visibles por RLS. `search` debe venir ya saneado. */
export async function countUsers(
  supabase: SupabaseClient<Database>,
  search: string,
  estatus: Estatus | null
): Promise<number> {
  let query = supabase.from('usuarios').select('id', { count: 'exact', head: true });

  if (estatus) {
    query = query.eq('estatus', estatus);
  }

  const filter = buildSearchFilter(search);
  const { count, error } = filter ? await query.or(filter) : await query;

  if (error) {
    throw new Error(`No se pudo contar los usuarios: ${error.message}`);
  }

  return count ?? 0;
}

/**
 * Página de usuarios dentro del rango válido. El recorte evita pedir un rango
 * fuera de la tabla, que PostgREST rechaza con `PGRST103`.
 */
export async function fetchUsersPage(
  supabase: SupabaseClient<Database>,
  search: string,
  page: number,
  totalPages: number,
  estatus: Estatus | null
): Promise<UsuarioListItem[]> {
  const currentPage = clampPage(page, totalPages);
  const from = (currentPage - 1) * USERS_PER_PAGE;
  const to = from + USERS_PER_PAGE - 1;

  let query = supabase
    .from('usuarios')
    .select('id, nombre, email, rol, estatus, email_confirmado, invitado_at')
    .order('nombre', { ascending: true })
    .order('email', { ascending: true });

  if (estatus) {
    query = query.eq('estatus', estatus);
  }

  const filter = buildSearchFilter(search);
  const { data, error } = filter
    ? await query.or(filter).range(from, to)
    : await query.range(from, to);

  if (error) {
    throw new Error(`No se pudo cargar la página de usuarios: ${error.message}`);
  }

  return data ?? [];
}

/** Listado paginado y filtrado. Devuelve el término saneado que se está usando. */
export async function listUsers(
  supabase: SupabaseClient<Database>,
  options: { search?: string; page?: number; estatus?: string }
): Promise<UsersListResult> {
  const search = sanitizeSearchTerm(options.search ?? '');
  const estatus = sanitizeEstatusFilter(options.estatus ?? '');
  const total = await countUsers(supabase, search, estatus);
  const totalPages = Math.max(1, Math.ceil(total / USERS_PER_PAGE));
  const page = clampPage(options.page ?? 1, totalPages);
  const usuarios = await fetchUsersPage(supabase, search, page, totalPages, estatus);

  return { usuarios, total, page, totalPages, search, estatus };
}
