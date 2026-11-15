import type { Database } from './database.types';

export type Rol = Database['public']['Enums']['rol_usuario'];

/** Lista blanca de roles, de menor a mayor privilegio. Única fuente de verdad. */
export const ROL_VALUES: readonly Rol[] = ['capturador', 'supervisor', 'admin'];

export const ROL_INFO: Record<Rol, { label: string; className: string }> = {
  admin: { label: 'Administrador', className: 'badge-neutral' },
  supervisor: { label: 'Supervisor', className: 'badge-secondary' },
  capturador: { label: 'Capturador', className: 'badge-ghost' }
};
