import type { AccountRoleValue } from '@/types/api'

export const ROLE_LABEL: Record<string, string> = {
  superadmin: 'Superadmin',
  administrator: 'Administrador',
  supervisor: 'Supervisor',
  agent: 'Asesor',
}

export const ROLE_HINT: Record<AccountRoleValue, string> = {
  administrator: 'Gestiona el número, el bot, el equipo y la configuración.',
  supervisor: 'Mueve gente entre equipos y reasigna conversaciones.',
  agent: 'Atiende conversaciones y ve contactos.',
}

export const ASSIGNABLE_ROLES: AccountRoleValue[] = ['administrator', 'supervisor', 'agent']

/** Roles que pueden reasignar conversaciones y responder las de otro. */
export const ELEVATED_ROLES = ['administrator', 'supervisor', 'superadmin']

export function isElevated(role: string | null): boolean {
  return !!role && ELEVATED_ROLES.includes(role)
}

export function isAdmin(role: string | null): boolean {
  return role === 'administrator' || role === 'superadmin'
}

/** Quién puede sumar/sacar gente; supervisor limitado a asesores (ver assignableRolesFor). */
export function canManageMembers(role: string | null): boolean {
  return isAdmin(role) || role === 'supervisor'
}

/** Un supervisor solo asigna asesores, igual que _guard_supervisor_role en el backend. */
export function assignableRolesFor(role: string | null): AccountRoleValue[] {
  if (isAdmin(role)) return ASSIGNABLE_ROLES
  if (role === 'supervisor') return ['agent']
  return []
}
