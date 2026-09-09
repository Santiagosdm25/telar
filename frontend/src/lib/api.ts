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

/**
 * Todas las llamadas a la API pasan por acá: agrega el header de auth,
 * castea JSON, y en 401 limpia la sesión (el que llama a apiFetch en un
 * contexto sin sesión propia -- ver auth.tsx -- decide qué hacer con eso).
 */
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken()
  const headers = new Headers(init.headers)
  // FormData (subida de archivos) necesita que el browser ponga su propio
  // Content-Type con el boundary del multipart -- si lo pisamos acá, el
  // backend no puede parsear el body.
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
    // fetch() solo tira acá cuando ni siquiera hubo respuesta del server:
    // DNS, conexión rechazada, timeout de red, CORS. Un 4xx/5xx real del
    // backend no pasa por acá -- eso es una respuesta válida, solo que
    // con un status de error (se maneja más abajo).
    reportApiNetworkFailure()
    throw e
  }
  reportApiSuccess() // hubo respuesta del server: la red anda, sea cual sea el status

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

/**
 * Para endpoints que devuelven el archivo en crudo (media adjunta a un
 * mensaje), no JSON -- apiFetch siempre castea a JSON, por eso esto va
 * aparte en vez de una opción más de apiFetch.
 */
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
