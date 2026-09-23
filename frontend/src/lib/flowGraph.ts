import type { Connection, Edge, Node } from '@xyflow/react'

import type { TriggerNodeData } from '@/components/flow/TriggerNode'
import type {
  AvailableToolResponse,
  BotGraph,
  BotGraphV2,
  GraphAgent,
  LegacyBotGraph,
} from '@/types/api'

/*
 * Modelo del lienzo (formato v2 del grafo, ver backend/telar/agent/multi_agent.py):
 *
 *   WhatsApp ━━► Agente principal
 *                    ┆ (puede usar)
 *          ┌─────────┼──────────────┐
 *     Herramienta  Herramienta   Sub-agente
 *                                    ┆ (puede usar)
 *                                Herramienta
 *
 * Para el principal, un sub-agente ES una herramienta (`delegar_<id>`): decide
 * él si lo llama y cuándo. Por eso sale del mismo punto que las herramientas
 * y se dibuja punteado, igual que ellas. Lo único sólido es WhatsApp →
 * principal, que pasa siempre.
 *
 * Qué usa cada agente no se edita con checkboxes: son las conexiones del
 * lienzo. flowToGraph() las lee de los edges (`data.kind`).
 */

export const START_ID = 'START'
export const TOOL_PREFIX = 'tool:'

/** Handles: `in` recibe, `tools` (abajo del agente) es de donde sale todo lo que puede usar. */
export const HANDLE = {
  in: 'in',
  tools: 'tools',
} as const

export type EdgeKind = 'trigger' | 'tool' | 'delegate'

export function edgeKind(edge: Edge): EdgeKind | undefined {
  return (edge.data as { kind?: EdgeKind } | undefined)?.kind
}

/** Solo el principal habla con el cliente, así que solo él puede transferirlo. */
export const MAIN_ONLY_TOOLS = new Set(['escalar_a_humano'])

export interface AgentNodeData {
  [key: string]: unknown
  role: 'main' | 'sub'
  name: string
  description: string
  systemPrompt: string
  /** null = sin límite (todo el historial). Solo aplica al principal. */
  memoryWindow: number | null
  /** Resaltado durante el chat de prueba: este agente actuó en el último turno. */
  active?: boolean
  toolCount?: number
  subCount?: number
}

export interface ToolNodeData {
  [key: string]: unknown
  name: string
  description: string
  kind: string
  /** La tool está en el grafo pero ya no existe en la cuenta (se borró en Configuración). */
  missing: boolean
  active?: boolean
}

export const DEFAULT_GRAPH: BotGraphV2 = {
  version: 2,
  agents: [
    {
      id: 'principal',
      role: 'main',
      name: 'Agente principal',
      system_prompt: null,
      tools: ['consultar_base_de_conocimiento', 'escalar_a_humano'],
      subagents: [],
      memory_window: 30,
    },
  ],
  layout: {},
}

const TRIGGER_POS = { x: 0, y: 140 }
const MAIN_POS = { x: 320, y: 120 }
/** Lo que un agente puede usar va una fila más abajo que él. */
export const CHILD_OFFSET_Y = 240
const WIDTH = { agent: 256, tool: 176 }
const GAP_X = 40

export function toolNodeId(name: string) {
  return `${TOOL_PREFIX}${name}`
}

export function isV2(graph: BotGraph): graph is BotGraphV2 {
  return graph.version === 2
}

/**
 * Bots guardados antes de v2 (cadena lineal de nodos): el primero pasa a ser
 * el principal y el resto sub-agentes suyos. No es idéntico en
 * comportamiento — en v1 corrían todos en fila — así que el editor avisa y
 * el cambio recién vale al guardar.
 */
export function legacyToV2(graph: LegacyBotGraph, availableTools: AvailableToolResponse[]): BotGraphV2 {
  const nextOf = new Map(graph.edges.map((e) => [e.from, e.to]))
  const byId = new Map(graph.nodes.map((n) => [n.id, n]))
  const order: string[] = []
  let current = nextOf.get(START_ID)
  while (current && current !== 'END' && !order.includes(current)) {
    order.push(current)
    current = nextOf.get(current)
  }
  if (order.length === 0) return DEFAULT_GRAPH

  const allTools = availableTools.map((t) => t.name)
  const agents: GraphAgent[] = order.map((id, i) => {
    const node = byId.get(id)
    const role = i === 0 ? 'main' : 'sub'
    // null en v1 = "todas las tools"; en v2 la lista es explícita.
    let tools = node?.tools ?? allTools
    if (role === 'sub') tools = tools.filter((t) => !MAIN_ONLY_TOOLS.has(t))
    const prompt = node?.system_prompt ?? null
    return {
      id: slugify(id),
      role,
      name: humanize(id),
      description:
        role === 'sub'
          ? `Paso "${humanize(id)}" del flujo anterior. ${prompt?.split('\n')[0] ?? ''}`.trim()
          : null,
      system_prompt: prompt,
      tools,
      subagents: [],
      memory_window: role === 'main' && node?.memory_window ? node.memory_window : null,
    }
  })
  agents[0].subagents = agents.slice(1).map((a) => a.id)
  return { version: 2, agents, layout: {} }
}

export function graphToFlow(
  graph: BotGraph,
  availableTools: AvailableToolResponse[],
): { nodes: Node[]; edges: Edge[]; converted: boolean } {
  const converted = !isV2(graph)
  const g = isV2(graph) ? graph : legacyToV2(graph, availableTools)
  const toolsByName = new Map(availableTools.map((t) => [t.name, t]))
  const layout = g.layout ?? {}

  const main = g.agents.find((a) => a.role === 'main') ?? DEFAULT_GRAPH.agents[0]
  const subs = g.agents.filter((a) => a.role === 'sub')

  const nodes: Node[] = []
  const edges: Edge[] = []

  nodes.push({
    id: START_ID,
    type: 'trigger',
    position: layout[START_ID] ?? TRIGGER_POS,
    data: { label: 'START', inboxName: null, phoneNumberId: null } satisfies TriggerNodeData,
    deletable: false,
  })

  const mainPos = layout[main.id] ?? MAIN_POS
  nodes.push(agentNode(main, mainPos))
  edges.push(triggerEdge(main.id))

  // Un nodo por herramienta, compartido: la misma API puede estar conectada a
  // varios agentes. También las que quedaron sueltas en el lienzo (layout).
  const toolNames = new Set<string>()
  for (const a of g.agents) a.tools.forEach((t) => toolNames.add(t))
  for (const key of Object.keys(layout)) {
    if (key.startsWith(TOOL_PREFIX)) toolNames.add(key.slice(TOOL_PREFIX.length))
  }
  const placedTools = new Set<string>()

  /** Pone una fila de hijos debajo de `parent`, centrada, salvo los que ya tienen posición guardada. */
  function placeRow(parent: { x: number; y: number }, children: { id: string; width: number }[]) {
    const total = children.reduce((sum, c) => sum + c.width, 0) + GAP_X * Math.max(children.length - 1, 0)
    let x = parent.x + WIDTH.agent / 2 - total / 2
    const positions = new Map<string, { x: number; y: number }>()
    for (const c of children) {
      positions.set(c.id, layout[c.id] ?? { x, y: parent.y + CHILD_OFFSET_Y })
      x += c.width + GAP_X
    }
    return positions
  }

  // Fila del principal: sus herramientas y sus sub-agentes, todo "lo que puede usar".
  const mainTools = main.tools.filter((t) => toolNames.has(t))
  const mainRow = placeRow(mainPos, [
    ...mainTools.map((t) => ({ id: toolNodeId(t), width: WIDTH.tool })),
    ...subs.map((s) => ({ id: s.id, width: WIDTH.agent })),
  ])
  for (const t of mainTools) {
    nodes.push(toolNode(t, toolsByName.get(t), mainRow.get(toolNodeId(t))!))
    placedTools.add(t)
  }
  for (const sub of subs) {
    const subPos = mainRow.get(sub.id)!
    nodes.push(agentNode(sub, subPos))
    const own = sub.tools.filter((t) => !placedTools.has(t))
    const subRow = placeRow(subPos, own.map((t) => ({ id: toolNodeId(t), width: WIDTH.tool })))
    for (const t of own) {
      nodes.push(toolNode(t, toolsByName.get(t), subRow.get(toolNodeId(t))!))
      placedTools.add(t)
    }
  }
  // Sueltas (en el layout pero sin agente): a la izquierda, fuera del camino.
  let looseY = mainPos.y + CHILD_OFFSET_Y
  for (const t of toolNames) {
    if (placedTools.has(t)) continue
    nodes.push(toolNode(t, toolsByName.get(t), layout[toolNodeId(t)] ?? { x: mainPos.x - 320, y: looseY }))
    looseY += 90
  }

  for (const subId of main.subagents ?? []) {
    if (subs.some((s) => s.id === subId)) edges.push(delegateEdge(main.id, subId))
  }
  for (const a of g.agents) {
    for (const t of a.tools) edges.push(toolEdge(a.id, t))
  }

  return { nodes: withToolCounts(nodes, edges), edges, converted }
}

export function flowToGraph(nodes: Node[], edges: Edge[]): BotGraphV2 {
  const agentNodes = nodes.filter((n) => n.type === 'agent')
  const toolName = (id: string) => (id.startsWith(TOOL_PREFIX) ? id.slice(TOOL_PREFIX.length) : null)

  const agents: GraphAgent[] = agentNodes.map((n) => {
    const data = n.data as AgentNodeData
    const outgoing = edges.filter((e) => e.source === n.id)
    const tools = outgoing
      .filter((e) => edgeKind(e) === 'tool')
      .map((e) => toolName(e.target))
      .filter((t): t is string => !!t)
    const agent: GraphAgent = {
      id: n.id,
      role: data.role,
      name: data.name.trim() || n.id,
      system_prompt: data.systemPrompt.trim() || null,
      tools: [...new Set(tools)],
    }
    if (data.role === 'main') {
      agent.subagents = outgoing.filter((e) => edgeKind(e) === 'delegate').map((e) => e.target)
      agent.memory_window = data.memoryWindow
    } else {
      agent.description = data.description.trim() || null
    }
    return agent
  })

  const layout: BotGraphV2['layout'] = {}
  for (const n of nodes) {
    layout[n.id] = { x: Math.round(n.position.x), y: Math.round(n.position.y) }
  }
  return { version: 2, agents, layout }
}

/** Qué conexiones se permiten al arrastrar en el lienzo, y por qué no. */
export function connectionProblem(
  connection: Connection | Edge,
  nodes: Node[],
  edges: Edge[],
): string | null {
  const source = nodes.find((n) => n.id === connection.source)
  const target = nodes.find((n) => n.id === connection.target)
  if (!source || !target || source.id === target.id) return 'Conexión inválida'
  if (source.type !== 'agent') return 'Las conexiones salen de un agente'

  if (connection.sourceHandle !== HANDLE.tools) return 'Conexión inválida'

  const role = (source.data as AgentNodeData).role
  if (target.type === 'tool') {
    const name = (target.data as ToolNodeData).name
    if (role === 'sub' && MAIN_ONLY_TOOLS.has(name)) {
      return 'Solo el agente principal puede transferir a un humano'
    }
  } else if (target.type === 'agent') {
    if ((target.data as AgentNodeData).role !== 'sub') return 'El principal no se puede conectar'
    if (role === 'sub') return 'Un sub-agente no puede usar otros sub-agentes (un solo nivel)'
  } else {
    return 'Desde abajo del agente se conectan herramientas o sub-agentes'
  }

  const duplicate = edges.some((e) => e.source === connection.source && e.target === connection.target)
  return duplicate ? 'Ya están conectados' : null
}

export function edgeForConnection(connection: Connection): Edge {
  return connection.target.startsWith(TOOL_PREFIX)
    ? toolEdge(connection.source, toolNameFromId(connection.target))
    : delegateEdge(connection.source, connection.target)
}

/** Los ids de las conexiones incluyen los de sus nodos: al renombrar un agente se recalculan. */
export function edgeIdFor(edge: Edge): string {
  const kind = edgeKind(edge)
  if (kind === 'delegate') return `delegate:${edge.source}->${edge.target}`
  if (kind === 'tool') return `tools:${edge.source}->${toolNameFromId(edge.target)}`
  return `${edge.source}->${edge.target}`
}

export function newAgentNode(role: 'sub', existingIds: Set<string>, position: { x: number; y: number }): Node {
  const name = 'Nuevo sub-agente'
  const id = uniqueNodeId(slugify(name), existingIds)
  return agentNode(
    { id, role, name, description: '', system_prompt: '', tools: [] },
    position,
  )
}

export function newToolNode(tool: AvailableToolResponse, position: { x: number; y: number }): Node {
  return toolNode(tool.name, tool, position)
}

/** Recalcula los contadores (herramientas y sub-agentes) que muestra cada agente. */
export function withToolCounts(nodes: Node[], edges: Edge[]): Node[] {
  return nodes.map((n) => {
    if (n.type !== 'agent') return n
    const outgoing = edges.filter((e) => e.source === n.id)
    const toolCount = outgoing.filter((e) => edgeKind(e) === 'tool').length
    const subCount = outgoing.filter((e) => edgeKind(e) === 'delegate').length
    const data = n.data as AgentNodeData
    return data.toolCount === toolCount && data.subCount === subCount
      ? n
      : { ...n, data: { ...data, toolCount, subCount } }
  })
}

/**
 * El id del agente termina en el nombre de la herramienta `delegar_<id>` y los
 * proveedores de modelos solo aceptan [a-z0-9_] ahí: se deriva del nombre.
 */
export function slugify(raw: string): string {
  const slug = raw
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)
  return slug || 'agente'
}

/** Si el slug ya lo usa otro nodo, le suma un sufijo numérico hasta que sea único. */
export function uniqueNodeId(base: string, existingIds: Set<string>): string {
  if (!existingIds.has(base)) return base
  let i = 2
  while (existingIds.has(`${base.slice(0, 36)}_${i}`)) i++
  return `${base.slice(0, 36)}_${i}`
}

export function toolNameFromId(id: string) {
  return id.startsWith(TOOL_PREFIX) ? id.slice(TOOL_PREFIX.length) : id
}

function agentNode(agent: GraphAgent, position: { x: number; y: number }): Node {
  const data: AgentNodeData = {
    role: agent.role,
    name: agent.name || humanize(agent.id),
    description: agent.description ?? '',
    systemPrompt: agent.system_prompt ?? '',
    memoryWindow: agent.memory_window ?? null,
  }
  return { id: agent.id, type: 'agent', position, data, deletable: agent.role !== 'main' }
}

function toolNode(
  name: string,
  tool: AvailableToolResponse | undefined,
  position: { x: number; y: number },
): Node {
  const data: ToolNodeData = {
    name,
    description: tool?.description.split('\n')[0] ?? '',
    kind: tool?.kind ?? 'system',
    missing: !tool,
  }
  return { id: toolNodeId(name), type: 'tool', position, data }
}

function triggerEdge(mainId: string): Edge {
  return {
    id: `${START_ID}->${mainId}`,
    source: START_ID,
    target: mainId,
    targetHandle: HANDLE.in,
    deletable: false,
    type: 'smoothstep',
    className: 'flow-edge-trigger',
    data: { kind: 'trigger' },
  }
}

function delegateEdge(from: string, to: string): Edge {
  return {
    id: `delegate:${from}->${to}`,
    source: from,
    sourceHandle: HANDLE.tools,
    target: to,
    targetHandle: HANDLE.in,
    label: 'si lo necesita',
    className: 'flow-edge-delegate',
    data: { kind: 'delegate' },
  }
}

function toolEdge(agentId: string, tool: string): Edge {
  return {
    id: `tools:${agentId}->${tool}`,
    source: agentId,
    sourceHandle: HANDLE.tools,
    target: toolNodeId(tool),
    targetHandle: HANDLE.in,
    className: 'flow-edge-tool',
    data: { kind: 'tool' },
  }
}

function humanize(id: string) {
  const text = id.replace(/_\d{10,}_\d+$/, '').replace(/_/g, ' ').trim()
  return text ? text[0].toUpperCase() + text.slice(1) : 'Agente'
}
