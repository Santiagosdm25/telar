import { reportApiNetworkFailure, reportApiSuccess } from '@/lib/networkStatus'

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'
const TOKEN_KEY = 'telar_token'

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token)
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY)
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/** Agrega auth, castea JSON y en 401 limpia la sesión. */
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken()
  const headers = new Headers(init.headers)
  // FormData necesita que el browser ponga su propio Content-Type con el boundary.
  if (!(init.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json')
  }
  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }

  let resp: Response
  try {
    resp = await fetch(`${API_URL}${path}`, { ...init, headers })
  } catch (e) {
    // Solo sin respuesta del server (DNS, conexión, CORS); un 4xx/5xx no llega acá.
    reportApiNetworkFailure()
    throw e
  }
  reportApiSuccess()

  if (resp.status === 401) {
    clearToken()
    throw new ApiError(401, 'No autenticado')
  }

  if (!resp.ok) {
    let detail = resp.statusText
    try {
      const body = await resp.json()
      detail = body.detail ?? detail
    } catch {
      // el body no era JSON, nos quedamos con statusText
    }
    throw new ApiError(resp.status, detail)
  }

  if (resp.status === 204) {
    return undefined as T
  }

  return (await resp.json()) as T
}

/** Para endpoints que devuelven el archivo en crudo, no JSON. */
export async function apiFetchBlob(path: string): Promise<Blob> {
  const token = getToken()
  const headers = new Headers()
  if (token) headers.set('Authorization', `Bearer ${token}`)

  const resp = await fetch(`${API_URL}${path}`, { headers })
  if (resp.status === 401) {
    clearToken()
    throw new ApiError(401, 'No autenticado')
  }
  if (!resp.ok) {
    throw new ApiError(resp.status, resp.statusText)
  }
  return resp.blob()
}
