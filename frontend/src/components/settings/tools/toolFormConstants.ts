import type { ToolKind } from '@/types/api'

export const CONFIG_PLACEHOLDER: Record<ToolKind, string> = {
  http: '{\n  "url": "https://api.tuempresa.com/pedidos",\n  "method": "GET",\n  "timeout_seconds": 10\n}',
  sql: '{\n  "query": "SELECT * FROM pedidos WHERE id = %(order_id)s"\n}',
  document: '', // document no usa este campo -- ver DOCUMENT_TEXT_PLACEHOLDER
}

export const SECRET_PLACEHOLDER: Record<ToolKind, string> = {
  http: '{\n  "headers": {"Authorization": "Bearer ..."}\n}',
  sql: '{\n  "connection_string": "postgresql://..."\n}',
  document: '', // document no tiene secreto: no llama a nada externo
}

export const DOCUMENT_TEXT_PLACEHOLDER =
  'Pegá acá el contenido -- preguntas frecuentes, políticas, catálogo en texto plano...'

export const KIND_HINT: Record<ToolKind, string> = {
  http: 'Llama una API externa que ya tenés.',
  sql: 'Consulta tu propia base de datos Postgres, siempre de solo lectura.',
  document: 'Un documento de referencia. Sin embeddings ni proveedor de LLM externo.',
}

export const SCHEMA_PLACEHOLDER =
  '{\n  "properties": {\n    "order_id": {"type": "string", "description": "número de pedido"}\n  },\n  "required": ["order_id"]\n}'

export interface ToolTemplate {
  key: string
  label: string
  name: string
  description: string
  config: Record<string, unknown>
  schema: Record<string, unknown>
  secret: Record<string, unknown>
}

/** Plantillas de arranque con URLs de ejemplo, claramente falsas. */
export const TOOL_TEMPLATES: ToolTemplate[] = [
  {
    key: 'consultar_estado_pedido',
    label: 'Estado de pedido',
    name: 'consultar_estado_pedido',
    description: 'Busca el estado de un pedido por su número.',
    config: { url: 'https://api.tu-erp.com/pedidos', method: 'GET', timeout_seconds: 10 },
    schema: {
      properties: { order_id: { type: 'string', description: 'número de pedido' } },
      required: ['order_id'],
    },
    secret: { headers: { Authorization: 'Bearer TU_TOKEN_AQUI' } },
  },
  {
    key: 'consultar_disponibilidad',
    label: 'Consultar disponibilidad',
    name: 'consultar_disponibilidad',
    description: 'Consulta los horarios disponibles para agendar una cita en una fecha dada.',
    config: { url: 'https://api.tu-calendario.com/disponibilidad', method: 'GET', timeout_seconds: 10 },
    schema: {
      properties: { fecha: { type: 'string', description: 'fecha a consultar, formato YYYY-MM-DD' } },
      required: ['fecha'],
    },
    secret: { headers: { Authorization: 'Bearer TU_TOKEN_AQUI' } },
  },
  {
    key: 'agendar_cita',
    label: 'Agendar cita',
    name: 'agendar_cita',
    description: 'Agenda una cita en la fecha y hora indicadas.',
    config: { url: 'https://api.tu-calendario.com/citas', method: 'POST', timeout_seconds: 10 },
    schema: {
      properties: {
        fecha: { type: 'string', description: 'fecha, formato YYYY-MM-DD' },
        hora: { type: 'string', description: 'hora, formato HH:MM' },
        nombre_cliente: { type: 'string', description: 'nombre de quien agenda' },
      },
      required: ['fecha', 'hora', 'nombre_cliente'],
    },
    secret: { headers: { Authorization: 'Bearer TU_TOKEN_AQUI' } },
  },
]

export function parseJsonField(raw: string, label: string): Record<string, unknown> | undefined {
  const trimmed = raw.trim()
  if (!trimmed) return undefined
  try {
    const parsed = JSON.parse(trimmed)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('not an object')
    }
    return parsed as Record<string, unknown>
  } catch {
    throw new Error(`${label} no es un JSON válido (tiene que ser un objeto, ej. {"clave": "valor"})`)
  }
}
