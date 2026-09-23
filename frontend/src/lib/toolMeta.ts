import { BookOpen, Database, FileText, Globe, Headset, Wrench, type LucideIcon } from 'lucide-react'

const KIND_LABEL: Record<string, string> = {
  system: 'Telar',
  http: 'API HTTP',
  sql: 'Consulta SQL',
  document: 'Documento',
}

/** Ícono de una herramienta del flujo, por nombre (las de Telar) o por tipo. */
export function toolIcon(name: string, kind: string): LucideIcon {
  if (name === 'consultar_base_de_conocimiento') return BookOpen
  if (name === 'escalar_a_humano') return Headset
  if (kind === 'http') return Globe
  if (kind === 'sql') return Database
  if (kind === 'document') return FileText
  return Wrench
}

export function toolKindLabel(kind: string) {
  return KIND_LABEL[kind] ?? kind
}
