import type { Database } from './database.types';

export type Estatus = Database['public']['Enums']['estatus_usuario'];

/** Lista blanca de estatus. Única fuente de verdad. */
export const ESTATUS_VALUES: readonly Estatus[] = ['activo', 'inactivo'];

export const ESTATUS_INFO: Record<Estatus, { label: string; className: string }> = {
  activo: { label: 'Activo', className: 'badge-success' },
  inactivo: { label: 'Inactivo', className: 'badge-error' }
};
