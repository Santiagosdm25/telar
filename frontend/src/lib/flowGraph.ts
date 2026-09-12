import type { Edge, Node } from '@xyflow/react'

import type { TriggerNodeData } from '@/components/flow/TriggerNode'
import type { BotGraph, GraphNode } from '@/types/api'

export const DEFAULT_GRAPH: BotGraph = {
  nodes: [{ id: 'agente_1', type: 'agent', system_prompt: null, tools: null, memory_window: null }],
  edges: [
    { from: 'START', to: 'agente_1' },
    { from: 'agente_1', to: 'END' },
  ],
}

const X_SPACING = 260
const ROW_Y = 120

export interface AgentNodeData {
  [key: string]: unknown
  systemPrompt: string | null
  tools: string[] | null
  /** null = sin límite (todo el historial que guarde la conversación). */
  memoryWindow: number | null
}

export interface EndpointNodeData {
  [key: string]: unknown
  label: 'END'
  phoneNumberId: string | null
}

/**
 * El JSON no guarda posición visual (v0 del compilador solo permite
 * cadenas lineales, sin ramas) -- el layout se recalcula siempre
 * siguiendo los edges desde START, en línea, de izquierda a derecha.
 */
export function graphToFlow(graph: BotGraph): { nodes: Node[]; edges: Edge[] } {
  const nextOf = new Map(graph.edges.map((e) => [e.from, e.to]))
  const nodesById = new Map(graph.nodes.map((n) => [n.id, n]))

  const order: string[] = ['START']
  let current = nextOf.get('START')
  const seen = new Set(['START'])
  while (current && current !== 'END' && !seen.has(current)) {
    order.push(current)
    seen.add(current)
    current = nextOf.get(current)
  }
  order.push('END')

  const nodes: Node[] = order.map((id, i) => {
    const position = { x: i * X_SPACING, y: ROW_Y }
    if (id === 'START') {
      const data: TriggerNodeData = { label: 'START', inboxName: null, phoneNumberId: null }
      return { id, type: 'trigger', position, data, draggable: false, deletable: false }
    }
    if (id === 'END') {
      const data: EndpointNodeData = { label: 'END', phoneNumberId: null }
      return { id, type: 'endpoint', position, data, draggable: false, deletable: false }
    }
    const graphNode = nodesById.get(id)
    const data: AgentNodeData = {
      systemPrompt: graphNode?.system_prompt ?? null,
      tools: graphNode?.tools ?? null,
      memoryWindow: graphNode?.memory_window ?? null,
    }
    return { id, type: 'agent', position, data }
  })

  const edges: Edge[] = graph.edges.map((e) => ({
    id: `${e.from}->${e.to}`,
    source: e.from,
    target: e.to,
  }))

  return { nodes, edges }
}

export function flowToGraph(nodes: Node[], edges: Edge[]): BotGraph {
  const graphNodes: GraphNode[] = nodes
    .filter((n) => n.type === 'agent')
    .map((n) => {
      const data = n.data as AgentNodeData
      return {
        id: n.id,
        type: 'agent',
        system_prompt: data.systemPrompt || null,
        tools: data.tools,
        memory_window: data.memoryWindow,
      }
    })

  const graphEdges = edges.map((e) => ({ from: e.source, to: e.target }))

  return { nodes: graphNodes, edges: graphEdges }
}

let nodeCounter = 0

export function newAgentNodeId(): string {
  nodeCounter += 1
  return `agente_${Date.now()}_${nodeCounter}`
}

/**
 * El nombre que el usuario escribe en "Nombre" se convierte en el `id`
 * real del nodo -- es lo único que el backend guarda (agent/compiler.py
 * no valida el charset, pero LangGraph usa el id como clave interna, así
 * que se restringe a algo seguro en vez de dejar pasar cualquier texto).
 */
export function slugifyNodeName(raw: string): string {
  const slug = raw
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // sin tildes
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return slug || 'agente'
}

/** Si el slug ya lo usa otro nodo, le suma un sufijo numérico hasta que sea único. */
export function uniqueNodeId(base: string, existingIds: Set<string>): string {
  if (!existingIds.has(base)) return base
  let i = 2
  while (existingIds.has(`${base}_${i}`)) i++
  return `${base}_${i}`
}

export interface AgentStep {
  id: string
  systemPrompt: string | null
  tools: string[] | null
  memoryWindow: number | null
}

/** El compilador solo entiende una cadena: este es el modelo del editor simple. */
export function graphToSteps(graph: BotGraph): AgentStep[] {
  const { nodes } = graphToFlow(graph)
  const steps = nodes
    .filter((n) => n.type === 'agent')
    .map((n) => {
      const data = n.data as AgentNodeData
      return {
        id: n.id,
        systemPrompt: data.systemPrompt,
        tools: data.tools,
        memoryWindow: data.memoryWindow,
      } satisfies AgentStep
    })
  return steps.length ? steps : graphToSteps(DEFAULT_GRAPH)
}

export function stepsToGraph(steps: AgentStep[]): BotGraph {
  const usable = steps.length ? steps : graphToSteps(DEFAULT_GRAPH)
  const nodes: GraphNode[] = usable.map((s) => ({
    id: s.id,
    type: 'agent',
    system_prompt: s.systemPrompt || null,
    tools: s.tools,
    memory_window: s.memoryWindow,
  }))
  const ids = usable.map((s) => s.id)
  const edges: { from: string; to: string }[] = [{ from: 'START', to: ids[0] }]
  for (let i = 0; i < ids.length - 1; i++) {
    edges.push({ from: ids[i], to: ids[i + 1] })
  }
  edges.push({ from: ids[ids.length - 1], to: 'END' })
  return { nodes, edges }
}
