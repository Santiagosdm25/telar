/**
 * Estado de red global, alimentado desde `apiFetch`. Store con useSyncExternalStore
 * (sin React Query ni contexto) para no perder fallos previos al montaje de los providers.
 */

type Listener = () => void

// Dos fallas seguidas: una request perdida aislada es normal en redes inestables.
const OFFLINE_THRESHOLD = 2

let consecutiveFailures = 0
let offline = false
const listeners = new Set<Listener>()

function emit() {
  for (const listener of listeners) listener()
}

/** Hubo respuesta, sea cual sea el status: la red anda. */
export function reportApiSuccess() {
  consecutiveFailures = 0
  if (offline) {
    offline = false
    emit()
  }
}

/** Solo cuando `fetch()` tiró sin respuesta del server. */
export function reportApiNetworkFailure() {
  consecutiveFailures += 1
  const shouldBeOffline = consecutiveFailures >= OFFLINE_THRESHOLD
  if (shouldBeOffline !== offline) {
    offline = shouldBeOffline
    emit()
  }
}

export function subscribeNetworkStatus(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getNetworkStatusSnapshot(): boolean {
  return offline
}
