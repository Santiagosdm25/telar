
const RELATIVE = new Intl.RelativeTimeFormat('es', { numeric: 'auto' })

/** "ahora", "hace 5 min", "hace 3 h", "ayer", "12 mar" */
export function relativeTime(iso: string | null): string {
  if (!iso) return '—'
  const date = new Date(iso)
  const diffMs = date.getTime() - Date.now()
  const diffMin = Math.round(diffMs / 60000)

  if (Math.abs(diffMin) < 1) return 'ahora'
  if (Math.abs(diffMin) < 60) return RELATIVE.format(diffMin, 'minute')

  const diffHour = Math.round(diffMin / 60)
  if (Math.abs(diffHour) < 24) return RELATIVE.format(diffHour, 'hour')

  const diffDay = Math.round(diffHour / 24)
  if (Math.abs(diffDay) < 7) return RELATIVE.format(diffDay, 'day')

  return date.toLocaleDateString('es', { day: 'numeric', month: 'short' })
}

/** Etiqueta corta para la lista: "14:32" hoy, "ayer", "12 mar" antes */
export function shortTimestamp(iso: string | null): string {
  if (!iso) return ''
  const date = new Date(iso)
  const now = new Date()
  const sameDay = date.toDateString() === now.toDateString()
  if (sameDay) return date.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })

  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (date.toDateString() === yesterday.toDateString()) return 'ayer'

  const sameYear = date.getFullYear() === now.getFullYear()
  return date.toLocaleDateString('es', {
    day: 'numeric',
    month: 'short',
    year: sameYear ? undefined : '2-digit',
  })
}

export function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })
}

export function dayLabel(iso: string): string {
  const date = new Date(iso)
  const now = new Date()
  if (date.toDateString() === now.toDateString()) return 'Hoy'

  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (date.toDateString() === yesterday.toDateString()) return 'Ayer'

  return date.toLocaleDateString('es', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: date.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  })
}

export function dayKey(iso: string): string {
  return new Date(iso).toDateString()
}

/** Iniciales para el avatar: máximo dos letras. */
export function initials(name: string | null | undefined, fallback = '?'): string {
  const clean = (name ?? '').trim()
  if (!clean) return fallback
  const parts = clean.split(/\s+/).filter(Boolean)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/** Tono estable por contacto. Decorativo: nunca es el único indicador de estado. */
const AVATAR_TONES = [
  'bg-[#FF6B4A]/14 text-[#A8351A] dark:text-[#FFB4A2]',
  'bg-[#E8A33D]/16 text-[#8A5A12] dark:text-[#F0C27B]',
  'bg-[#E85D75]/14 text-[#A32D42] dark:text-[#F5A3B0]',
  'bg-[#C9A227]/16 text-[#7A6114] dark:text-[#E3CE7E]',
  'bg-[#C1512E]/14 text-[#8F3A1F] dark:text-[#EDA184]',
  'bg-[#6E9E7F]/16 text-[#3F6B50] dark:text-[#A6CDB4]',
  'bg-[#8A8A8A]/16 text-[#4F4F4F] dark:text-[#C4C4C4]',
  'bg-[#A05C8A]/14 text-[#77406A] dark:text-[#DDA9CC]',
]

export function avatarTone(seed: string): string {
  let hash = 0
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0
  return AVATAR_TONES[hash % AVATAR_TONES.length]
}

/** +57 300 123 4567 — agrupa sin inventar formato local */
export function formatPhone(phone: string | null | undefined): string {
  if (!phone) return '—'
  const digits = phone.replace(/\D/g, '')
  if (digits.length < 8) return phone
  const country = digits.length > 10 ? digits.slice(0, digits.length - 10) : ''
  const rest = digits.slice(-10)
  return `${country ? `+${country} ` : ''}${rest.slice(0, 3)} ${rest.slice(3, 6)} ${rest.slice(6)}`
}
