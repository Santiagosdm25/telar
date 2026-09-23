import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Bot,
  Braces,
  History,
  Info,
  Loader2,
  Plus,
  RotateCcw,
  Save,
  TestTube2,
  Wrench,
  X,
} from 'lucide-react'
import * as React from 'react'
import { useParams } from 'react-router-dom'
import { toast } from 'sonner'

import { AgentNode } from '@/components/flow/AgentNode'
import { InboxConnectionPanel } from '@/components/flow/InboxConnectionPanel'
import { NodeEditPanel } from '@/components/flow/NodeEditPanel'
import { TestChatPanel } from '@/components/flow/TestChatPanel'
import { ToolNode } from '@/components/flow/ToolNode'
import { ToolPanel } from '@/components/flow/ToolPanel'
import { TriggerNode, type TriggerNodeData } from '@/components/flow/TriggerNode'
import { MobileMenuButton } from '@/components/layout/MobileMenuButton'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ApiError } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import {
  activateBotVersion,
  getAvailableTools,
  getBot,
  getBotVersions,
  getInboxes,
  getMembers,
  saveBot,
} from '@/lib/endpoints'
import {
  CHILD_OFFSET_Y,
  DEFAULT_GRAPH,
  HANDLE,
  START_ID,
  connectionProblem,
  edgeForConnection,
  edgeIdFor,
  edgeKind,
  flowToGraph,
  graphToFlow,
  newAgentNode,
  newToolNode,
  slugify,
  toolNameFromId,
  toolNodeId,
  uniqueNodeId,
  withToolCounts,
  type AgentNodeData,
  type ToolNodeData,
} from '@/lib/flowGraph'
import { shortTimestamp } from '@/lib/format'
import { isAdmin } from '@/lib/roles'
import { queryKeys } from '@/lib/queryKeys'
import { useTheme } from '@/lib/theme'
import { toolIcon, toolKindLabel } from '@/lib/toolMeta'
import type { AvailableToolResponse, BotGraph, TraceEvent } from '@/types/api'

const nodeTypes = { agent: AgentNode, tool: ToolNode, trigger: TriggerNode }

function BotFlowEditor({ accountId }: { accountId: string }) {
  const queryClient = useQueryClient()
  const { resolved } = useTheme()
  const { roleForAccount } = useAuth()
  const canManageVersions = isAdmin(roleForAccount(accountId))
  const [nodes, setNodes, applyNodeChanges] = useNodesState<Node>([])
  const [edges, setEdges, applyEdgeChanges] = useEdgesState<Edge>([])
  const [selectedNodeId, setSelectedNodeId] = React.useState<string | null>(null)
  const [showJson, setShowJson] = React.useState(false)
  const [testChatOpen, setTestChatOpen] = React.useState(false)
  const [versionsOpen, setVersionsOpen] = React.useState(false)
  const [hydrated, setHydrated] = React.useState(false)
  const [converted, setConverted] = React.useState(false)
  const [dirty, setDirty] = React.useState(false)
  const [notes, setNotes] = React.useState('')

  const { data: bot } = useQuery({ queryKey: queryKeys.bot(accountId), queryFn: () => getBot(accountId) })
  const { data: availableTools } = useQuery({
    queryKey: queryKeys.availableTools(accountId),
    queryFn: () => getAvailableTools(accountId),
  })
  const { data: inboxes } = useQuery({
    queryKey: queryKeys.inboxes(accountId),
    queryFn: () => getInboxes(accountId),
  })

  const loadGraph = React.useCallback(
    (graph: BotGraph, tools: AvailableToolResponse[]) => {
      const flow = graphToFlow(graph, tools)
      setNodes(flow.nodes)
      setEdges(flow.edges)
      setConverted(flow.converted)
      // Un bot del formato viejo se convierte al abrirlo: queda "sin guardar"
      // para que el cambio sea explícito, no silencioso.
      setDirty(flow.converted)
    },
    [setNodes, setEdges],
  )

  // Hacen falta las dos cosas: las tools definen tipo e íconos de cada nodo.
  React.useEffect(() => {
    if (hydrated || bot === undefined || availableTools === undefined) return
    loadGraph(bot?.graph ?? DEFAULT_GRAPH, availableTools)
    setHydrated(true)
  }, [bot, availableTools, hydrated, loadGraph])

  /* El nodo de WhatsApp no vive en el JSON (START es solo un ancla): se le
     inyecta la conexión real acá. */
  React.useEffect(() => {
    if (!hydrated || inboxes === undefined) return
    const primary = inboxes[0]
    setNodes((current) =>
      current.map((n) =>
        n.type === 'trigger'
          ? {
              ...n,
              data: {
                label: 'START',
                inboxName: primary?.name ?? null,
                phoneNumberId: primary?.phone_number_id ?? null,
              } satisfies TriggerNodeData,
            }
          : n,
      ),
    )
  }, [inboxes, hydrated, setNodes])

  const saveMutation = useMutation({
    mutationFn: () => saveBot(accountId, bot?.name ?? 'Bot principal', flowToGraph(nodes, edges), notes),
    onSuccess: () => {
      setDirty(false)
      setConverted(false)
      setNotes('')
      toast.success('Flujo guardado', { description: 'Los cambios ya están activos.' })
      queryClient.invalidateQueries({ queryKey: queryKeys.bot(accountId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.botVersions(accountId) })
    },
    onError: (e) => {
      toast.error(e instanceof ApiError ? e.message : 'No se pudo guardar el flujo')
    },
  })

  function handleSave() {
    const missing = nodes.find(
      (n) => n.type === 'agent' && (n.data as AgentNodeData).role === 'sub' && !(n.data as AgentNodeData).description.trim(),
    )
    if (missing) {
      setSelectedNodeId(missing.id)
      setTestChatOpen(false)
      toast.error(`Falta describir cuándo se llama a "${(missing.data as AgentNodeData).name}"`)
      return
    }
    saveMutation.mutate()
  }

  async function handleVersionActivated() {
    const fresh = await getBot(accountId)
    if (fresh) loadGraph(fresh.graph, availableTools ?? [])
    setDirty(false)
    setNotes('')
    queryClient.setQueryData(queryKeys.bot(accountId), fresh)
    queryClient.invalidateQueries({ queryKey: queryKeys.botVersions(accountId) })
  }

  /* Cambios del lienzo: mover o borrar con el teclado también cuenta como
     "sin guardar" (antes borrar una conexión con Backspace no lo marcaba). */
  const onNodesChange = React.useCallback(
    (changes: NodeChange[]) => {
      applyNodeChanges(changes)
      if (changes.some((c) => c.type === 'remove' || (c.type === 'position' && c.dragging === false))) {
        setDirty(true)
      }
      if (changes.some((c) => c.type === 'remove' && c.id === selectedNodeId)) setSelectedNodeId(null)
    },
    [applyNodeChanges, selectedNodeId],
  )

  const onEdgesChange = React.useCallback(
    (changes: EdgeChange[]) => {
      applyEdgeChanges(changes)
      if (changes.some((c) => c.type === 'remove')) setDirty(true)
    },
    [applyEdgeChanges],
  )

  // El contador de herramientas de cada agente sigue a las conexiones.
  React.useEffect(() => {
    setNodes((current) => withToolCounts(current, edges))
  }, [edges, setNodes])

  const isValidConnection = React.useCallback(
    (c: Connection | Edge) => connectionProblem(c, nodes, edges) === null,
    [nodes, edges],
  )

  const onConnect = React.useCallback(
    (connection: Connection) => {
      const problem = connectionProblem(connection, nodes, edges)
      if (problem) {
        toast.error(problem)
        return
      }
      setEdges((current) => [...current, edgeForConnection(connection)])
      setDirty(true)
    },
    [nodes, edges, setEdges],
  )

  const mainNode = nodes.find((n) => n.type === 'agent' && (n.data as AgentNodeData).role === 'main')

  /** Siguiente lugar libre en la fila de lo que `parent` puede usar (debajo de él). */
  function nextChildSlot(parent: { x: number; y: number }) {
    const rowY = parent.y + CHILD_OFFSET_Y
    const inRow = nodes.filter((n) => n.id !== START_ID && Math.abs(n.position.y - rowY) < 60)
    const right = inRow.reduce((max, n) => Math.max(max, n.position.x + (n.type === 'agent' ? 256 : 176)), -Infinity)
    return { x: Number.isFinite(right) ? right + 40 : parent.x, y: rowY }
  }

  function handleAddSubAgent() {
    const ids = new Set(nodes.map((n) => n.id))
    const node = newAgentNode('sub', ids, nextChildSlot(mainNode?.position ?? { x: 320, y: 120 }))
    setNodes((current) => [...current, node])
    // Recién creado, casi siempre se quiere que el principal lo pueda usar.
    if (mainNode) {
      setEdges((current) => [
        ...current,
        edgeForConnection({
          source: mainNode.id,
          sourceHandle: HANDLE.tools,
          target: node.id,
          targetHandle: HANDLE.in,
        }),
      ])
    }
    setSelectedNodeId(node.id)
    setTestChatOpen(false)
    setDirty(true)
  }

  function handleAddTool(tool: AvailableToolResponse) {
    const id = toolNodeId(tool.name)
    if (!nodes.some((n) => n.id === id)) {
      const target = nodes.find((n) => n.id === selectedNodeId && n.type === 'agent') ?? mainNode
      setNodes((current) => [
        ...current,
        newToolNode(tool, nextChildSlot(target?.position ?? { x: 320, y: 120 })),
      ])
      setDirty(true)
    }
    setSelectedNodeId(id)
    setTestChatOpen(false)
  }

  function handleNodeClick(_: React.MouseEvent, node: Node) {
    setSelectedNodeId(node.id)
    setTestChatOpen(false)
  }

  function handleNodeDataChange(nodeId: string, data: AgentNodeData) {
    setNodes((current) => current.map((n) => (n.id === nodeId ? { ...n, data } : n)))
    setDirty(true)
  }

  function handleRename(nodeId: string, name: string) {
    const node = nodes.find((n) => n.id === nodeId)
    if (!node) return
    const data = { ...(node.data as AgentNodeData), name }
    // El id del principal no cambia; el de un sub-agente sigue a su nombre
    // porque termina en la herramienta `delegar_<id>` que ve el modelo.
    const newId =
      data.role === 'main'
        ? nodeId
        : uniqueNodeId(slugify(name), new Set(nodes.filter((n) => n.id !== nodeId).map((n) => n.id)))

    setNodes((current) => current.map((n) => (n.id === nodeId ? { ...n, id: newId, data } : n)))
    if (newId !== nodeId) {
      setEdges((current) =>
        current.map((e) => {
          if (e.source !== nodeId && e.target !== nodeId) return e
          const next = {
            ...e,
            source: e.source === nodeId ? newId : e.source,
            target: e.target === nodeId ? newId : e.target,
          }
          return { ...next, id: edgeIdFor(next) }
        }),
      )
      setSelectedNodeId(newId)
    }
    setDirty(true)
  }

  function handleDisconnect(sourceId: string, targetId: string) {
    setEdges((current) => current.filter((e) => !(e.source === sourceId && e.target === targetId)))
    setDirty(true)
  }

  function handleDeleteNode(nodeId: string) {
    setNodes((current) => current.filter((n) => n.id !== nodeId))
    setEdges((current) => current.filter((e) => e.source !== nodeId && e.target !== nodeId))
    setSelectedNodeId(null)
    setDirty(true)
  }

  /* Resalta en el lienzo lo que actuó en el último turno del chat de prueba.
     No marca "sin guardar": `active` no va al JSON. */
  const handleTrace = React.useCallback(
    (trace: TraceEvent[] | null) => {
      const agents = new Set(trace?.map((e) => e.agent))
      const used = new Set(
        trace
          ?.filter((e) => e.kind === 'tool_call' && e.name && !e.name.startsWith('delegar_'))
          .map((e) => `${e.agent}->${e.name}`),
      )
      const delegated = new Set(
        trace
          ?.filter((e) => e.kind === 'tool_call' && e.name?.startsWith('delegar_'))
          .map((e) => `${e.agent}->${e.name!.slice('delegar_'.length)}`),
      )
      const usedTools = new Set([...used].map((k) => k.split('->')[1]))
      setNodes((current) =>
        current.map((n) => {
          const active =
            n.type === 'agent' ? agents.has(n.id) : n.type === 'tool' ? usedTools.has(toolNameFromId(n.id)) : false
          return (n.data as { active?: boolean }).active === active ? n : { ...n, data: { ...n.data, active } }
        }),
      )
      setEdges((current) =>
        current.map((e) => {
          const key = `${e.source}->${toolNameFromId(e.target)}`
          const kind = edgeKind(e)
          const animated =
            kind === 'delegate' ? delegated.has(`${e.source}->${e.target}`) : kind === 'tool' && used.has(key)
          return !!e.animated === animated ? e : { ...e, animated }
        }),
      )
    },
    [setNodes, setEdges],
  )

  const selectedNode = nodes.find((n) => n.id === selectedNodeId)
  const graphPreview = React.useMemo(() => flowToGraph(nodes, edges), [nodes, edges])
  const agentNames = React.useMemo(
    () =>
      Object.fromEntries(
        nodes.filter((n) => n.type === 'agent').map((n) => [n.id, (n.data as AgentNodeData).name]),
      ),
    [nodes],
  )
  const agentCount = nodes.filter((n) => n.type === 'agent').length
  const toolsOnCanvas = new Set(nodes.filter((n) => n.type === 'tool').map((n) => toolNameFromId(n.id)))

  const selectedAgentTools =
    selectedNode?.type === 'agent'
      ? edges
          .filter((e) => e.source === selectedNode.id && edgeKind(e) === 'tool')
          .map((e) => nodes.find((n) => n.id === e.target)?.data as ToolNodeData | undefined)
          .filter((d): d is ToolNodeData => !!d)
      : []
  const selectedAgentSubs =
    selectedNode?.type === 'agent'
      ? edges
          .filter((e) => e.source === selectedNode.id && edgeKind(e) === 'delegate')
          .map((e) => ({ id: e.target, name: agentNames[e.target] ?? e.target }))
      : []
  const selectedToolUsers =
    selectedNode?.type === 'tool'
      ? edges
          .filter((e) => e.target === selectedNode.id)
          .map((e) => ({ id: e.source, name: agentNames[e.source] ?? e.source }))
      : []

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-surface px-5">
        <MobileMenuButton />
        <h1 className="text-[15px] font-semibold tracking-tight">Flujo del bot</h1>
        <span className="tabular hidden shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-xs text-muted-foreground sm:inline-flex">
          {agentCount} {agentCount === 1 ? 'agente' : 'agentes'} · {toolsOnCanvas.size}{' '}
          {toolsOnCanvas.size === 1 ? 'herramienta' : 'herramientas'}
        </span>
        {bot && (
          <span className="hidden shrink-0 text-xs text-muted-foreground xl:inline">
            {bot.name} · v{bot.version}
          </span>
        )}
        {dirty && (
          <span className="hidden shrink-0 items-center gap-1.5 text-xs font-medium text-status-pending sm:flex">
            <span className="size-1.5 rounded-full bg-status-pending" />
            Sin guardar
          </span>
        )}

        <div className="ml-auto flex min-w-0 items-center gap-1.5 sm:gap-2">
          {dirty && (
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Notas (opcional)"
              aria-label="Notas de esta versión"
              className="h-8 w-28 min-w-0 text-[13px] sm:w-40 lg:w-56"
            />
          )}
          <Button variant="outline" size="sm" onClick={handleAddSubAgent} aria-label="Agregar sub-agente">
            <Plus />
            <Bot />
            <span className="hidden xl:inline">Sub-agente</span>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" aria-label="Agregar herramienta">
                <Plus />
                <Wrench />
                <span className="hidden xl:inline">Herramienta</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72">
              <ToolMenuItems
                tools={availableTools ?? []}
                onCanvas={toolsOnCanvas}
                onPick={handleAddTool}
              />
            </DropdownMenuContent>
          </DropdownMenu>
          {canManageVersions && (
            <Button
              variant={testChatOpen ? 'secondary' : 'ghost'}
              size="sm"
              aria-label="Probar"
              onClick={() => {
                setTestChatOpen((v) => !v)
                setSelectedNodeId(null)
                setShowJson(false)
              }}
              aria-pressed={testChatOpen}
            >
              <TestTube2 />
              <span className="hidden xl:inline">Probar</span>
            </Button>
          )}
          <Button
            variant={showJson ? 'secondary' : 'ghost'}
            size="sm"
            aria-label="JSON"
            onClick={() => {
              setShowJson((v) => !v)
              setTestChatOpen(false)
            }}
            aria-pressed={showJson}
          >
            <Braces />
            <span className="hidden xl:inline">JSON</span>
          </Button>
          <Button variant="ghost" size="sm" aria-label="Versiones" onClick={() => setVersionsOpen(true)}>
            <History />
            <span className="hidden xl:inline">Versiones</span>
          </Button>
          <Button
            size="sm"
            aria-label={saveMutation.isPending ? 'Guardando' : 'Guardar'}
            onClick={handleSave}
            disabled={saveMutation.isPending || !dirty}
          >
            {saveMutation.isPending ? <Loader2 className="animate-spin" /> : <Save />}
            <span className="hidden xl:inline">{saveMutation.isPending ? 'Guardando…' : 'Guardar'}</span>
          </Button>
        </div>
      </header>

      <div className="flex shrink-0 items-center gap-2 border-b border-border bg-surface-2 px-5 py-2 text-[12.5px] text-muted-foreground">
        <Info className="size-3.5 shrink-0" />
        {converted ? (
          <p>
            <span className="font-medium text-foreground">Flujo convertido al formato nuevo.</span> El
            primer paso pasó a ser el agente principal y el resto, sub-agentes suyos. Revisalo y guardá
            para activarlo.
          </p>
        ) : (
          <p>
            El <span className="font-medium text-foreground">principal</span> habla con el cliente. Lo que le
            conectás abajo (herramientas y <span className="font-medium text-primary">sub-agentes</span>) lo{' '}
            <span className="font-medium text-foreground">puede usar</span>: decide él en cada mensaje si hace
            falta. Las líneas punteadas son opcionales; la única que pasa siempre es WhatsApp → principal.
          </p>
        )}
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="relative min-h-0 min-w-0 flex-1 bg-[radial-gradient(ellipse_at_center,var(--surface-2)_0%,var(--background)_65%)]">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            isValidConnection={isValidConnection}
            onNodeClick={handleNodeClick}
            onPaneClick={() => setSelectedNodeId(null)}
            nodeTypes={nodeTypes}
            colorMode={resolved}
            proOptions={{ hideAttribution: true }}
            fitView
            fitViewOptions={{ padding: 0.25, maxZoom: 1 }}
          >
            <Background variant={BackgroundVariant.Dots} gap={28} size={1} color="var(--border)" />
            <Controls showInteractive={false} />
            <MiniMap
              pannable
              zoomable
              className="!right-4 !bottom-4 !h-24 !w-40 !rounded-lg !border !border-border !bg-surface"
              maskColor="color-mix(in srgb, var(--background) 70%, transparent)"
              nodeColor="var(--border-strong)"
            />
          </ReactFlow>
        </div>

        {showJson && (
          <aside className="flex w-[380px] shrink-0 flex-col border-l border-border bg-surface">
            <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4">
              <h2 className="flex-1 text-[13px] font-semibold">
                JSON del grafo
                <span className="ml-2 font-normal text-muted-foreground">bot_versions.graph</span>
              </h2>
              <Button variant="ghost" size="icon-sm" onClick={() => setShowJson(false)} aria-label="Cerrar JSON">
                <X />
              </Button>
            </header>
            <pre className="min-h-0 flex-1 overflow-auto p-4 font-mono text-[11.5px] leading-relaxed text-muted-foreground">
              {JSON.stringify(graphPreview, null, 2)}
            </pre>
          </aside>
        )}

        {testChatOpen && !selectedNode && (
          <TestChatPanel
            accountId={accountId}
            agentNames={agentNames}
            onTrace={handleTrace}
            onClose={() => {
              setTestChatOpen(false)
              handleTrace(null)
            }}
          />
        )}

        {selectedNode?.type === 'agent' && (
          <NodeEditPanel
            accountId={accountId}
            nodeId={selectedNode.id}
            data={selectedNode.data as AgentNodeData}
            connectedTools={selectedAgentTools}
            subagents={selectedAgentSubs}
            onChange={(data) => handleNodeDataChange(selectedNode.id, data)}
            onRename={(name) => handleRename(selectedNode.id, name)}
            onDisconnect={(targetId) => handleDisconnect(selectedNode.id, targetId)}
            onSelect={setSelectedNodeId}
            onDelete={() => handleDeleteNode(selectedNode.id)}
            onClose={() => setSelectedNodeId(null)}
          />
        )}

        {selectedNode?.type === 'tool' && (
          <ToolPanel
            accountId={accountId}
            data={selectedNode.data as ToolNodeData}
            usedBy={selectedToolUsers}
            onSelect={setSelectedNodeId}
            onRemove={() => handleDeleteNode(selectedNode.id)}
            onClose={() => setSelectedNodeId(null)}
          />
        )}

        {selectedNode?.id === START_ID && (
          <InboxConnectionPanel accountId={accountId} inboxes={inboxes ?? []} onClose={() => setSelectedNodeId(null)} />
        )}
      </div>

      <BotVersionsDialog
        accountId={accountId}
        open={versionsOpen}
        onOpenChange={setVersionsOpen}
        canActivate={canManageVersions}
        onActivated={handleVersionActivated}
      />
    </div>
  )
}

function ToolMenuItems({
  tools,
  onCanvas,
  onPick,
}: {
  tools: AvailableToolResponse[]
  onCanvas: Set<string>
  onPick: (tool: AvailableToolResponse) => void
}) {
  const system = tools.filter((t) => t.kind === 'system')
  const custom = tools.filter((t) => t.kind !== 'system')

  const item = (tool: AvailableToolResponse) => {
    const Icon = toolIcon(tool.name, tool.kind)
    return (
      <DropdownMenuItem key={tool.name} onSelect={() => onPick(tool)} className="items-start">
        <Icon className="mt-0.5 text-status-resolved" />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-mono text-[12px]">{tool.name}</span>
          <span className="block truncate text-[11px] text-muted-foreground">
            {toolKindLabel(tool.kind)}
            {onCanvas.has(tool.name) && ' · ya está en el lienzo'}
          </span>
        </span>
      </DropdownMenuItem>
    )
  }

  return (
    <>
      <DropdownMenuLabel>De Telar</DropdownMenuLabel>
      {system.map(item)}
      <DropdownMenuSeparator />
      <DropdownMenuLabel>De la cuenta</DropdownMenuLabel>
      {custom.length ? (
        custom.map(item)
      ) : (
        <p className="px-2 py-1.5 text-[12px] text-muted-foreground">
          Todavía no hay. Creá APIs y consultas SQL en Configuración → Herramientas.
        </p>
      )}
    </>
  )
}

function BotVersionsDialog({
  accountId,
  open,
  onOpenChange,
  canActivate,
  onActivated,
}: {
  accountId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  canActivate: boolean
  onActivated: () => void
}) {
  const { data: versions, isLoading } = useQuery({
    queryKey: queryKeys.botVersions(accountId),
    queryFn: () => getBotVersions(accountId),
    enabled: open,
  })

  /* Solo para mostrar un nombre en vez del uuid de created_by. */
  const { data: members } = useQuery({
    queryKey: queryKeys.members(accountId),
    queryFn: () => getMembers(accountId),
    enabled: open,
    staleTime: 60_000,
  })

  const activate = useMutation({
    mutationFn: (versionId: string) => activateBotVersion(accountId, versionId),
    onSuccess: (version) => {
      toast.success(`Restaurada la versión ${version.version}`)
      onActivated()
    },
    onError: (e) =>
      toast.error(e instanceof ApiError ? e.message : 'No se pudo restaurar esta versión'),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Versiones del bot</DialogTitle>
          <DialogDescription>
            Cada "Guardar" queda como una versión nueva. Restaurar una vieja la vuelve a activar
            tal cual estaba, sin perder las demás.
          </DialogDescription>
        </DialogHeader>

        {isLoading && (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-10 rounded-lg" />
            ))}
          </div>
        )}

        {versions?.length === 0 && (
          <p className="text-[13px] text-muted-foreground">Todavía no hay versiones guardadas.</p>
        )}

        {versions && versions.length > 0 && (
          <div className="max-h-[360px] overflow-y-auto rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="pl-4">Versión</TableHead>
                  <TableHead>Notas</TableHead>
                  <TableHead>Creado por</TableHead>
                  <TableHead>Fecha</TableHead>
                  <TableHead className="w-px pr-4" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {versions.map((v) => {
                  const author = members?.find((m) => m.user_id === v.created_by)
                  return (
                    <TableRow key={v.id}>
                      <TableCell className="pl-4 font-medium whitespace-nowrap">
                        v{v.version}
                        {v.is_active && (
                          <Badge variant="secondary" className="ml-2">
                            Activa
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="max-w-[200px] truncate text-muted-foreground">
                        {v.notes || '—'}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {author?.name ?? (v.created_by ? 'Ya no está en la cuenta' : '—')}
                      </TableCell>
                      <TableCell className="tabular text-muted-foreground">
                        {shortTimestamp(v.created_at)}
                      </TableCell>
                      <TableCell className="pr-4 text-right">
                        {!v.is_active && canActivate && (
                          <Button
                            variant="outline"
                            size="xs"
                            disabled={activate.isPending}
                            onClick={() => activate.mutate(v.id)}
                          >
                            <RotateCcw />
                            Restaurar
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

export function BotFlowPage() {
  const { accountId } = useParams<{ accountId: string }>()
  if (!accountId) return null

  return (
    <ReactFlowProvider>
      <BotFlowEditor accountId={accountId} />
    </ReactFlowProvider>
  )
}
