/**
 * Ventana de 24h de Meta, calculada en el cliente para avisar antes de que el
 * backend rechace el envío con 409 (`state.window_is_open()`).
 */

export const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000

/** Avisamos cuando falten menos de estas horas. */
const WARN_THRESHOLD_MS = 4 * 60 * 60 * 1000

export interface ServiceWindow {
  /** Se puede enviar texto libre. */
  open: boolean
  /** Nunca escribió: no hay ventana que abrir. */
  never: boolean
  closesAt: Date | null
  msLeft: number
  /** Está por cerrarse: vale la pena mostrarlo. */
  warning: boolean
  label: string
}

export function serviceWindow(
  lastContactMessageAt: string | null | undefined,
  now: number = Date.now(),
): ServiceWindow {
  if (!lastContactMessageAt) {
    return {
      open: false,
      never: true,
      closesAt: null,
      msLeft: 0,
      warning: false,
      label: 'sin mensajes del contacto',
    }
  }

  const closesAt = new Date(new Date(lastContactMessageAt).getTime() + SERVICE_WINDOW_MS)
  const msLeft = closesAt.getTime() - now

  return {
    open: msLeft > 0,
    never: false,
    closesAt,
    msLeft,
    warning: msLeft > 0 && msLeft < WARN_THRESHOLD_MS,
    label: formatLeft(msLeft),
  }
}

function formatLeft(ms: number): string {
  if (ms <= 0) return 'cerrada'
  const totalMinutes = Math.floor(ms / 60000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours >= 1) return `${hours} h ${minutes} min`
  return `${minutes} min`
}
