import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Braces, History, Info, Loader2, Plus, RotateCcw, Save, TestTube2, X } from 'lucide-react'
import * as React from 'react'
import { useParams } from 'react-router-dom'
import { toast } from 'sonner'

import { AgentNode } from '@/components/flow/AgentNode'
import { EndpointNode, type EndpointNodeData } from '@/components/flow/EndpointNode'
import { OutputConfigPanel } from '@/components/flow/OutputConfigPanel'
import { InboxConnectionPanel } from '@/components/flow/InboxConnectionPanel'
import { NodeEditPanel } from '@/components/flow/NodeEditPanel'
import { TestChatPanel } from '@/components/flow/TestChatPanel'
import { TriggerNode, type TriggerNodeData } from '@/components/flow/TriggerNode'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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
  DEFAULT_GRAPH,
  flowToGraph,
  graphToFlow,
  newAgentNodeId,
  type AgentNodeData,
} from '@/lib/flowGraph'
import { shortTimestamp } from '@/lib/format'
import { isAdmin } from '@/lib/roles'
import { queryKeys } from '@/lib/queryKeys'
import { useTheme } from '@/lib/theme'

const nodeTypes = { agent: AgentNode, endpoint: EndpointNode, trigger: TriggerNode }

function BotFlowEditor({ accountId }: { accountId: string }) {
  const queryClient = useQueryClient()
  const { resolved } = useTheme()
  const { roleForAccount } = useAuth()
  const canManageVersions = isAdmin(roleForAccount(accountId))
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])
  const [selectedNodeId, setSelectedNodeId] = React.useState<string | null>(null)
  const [showJson, setShowJson] = React.useState(false)
  const [testChatOpen, setTestChatOpen] = React.useState(false)
  const [versionsOpen, setVersionsOpen] = React.useState(false)
  const [hydrated, setHydrated] = React.useState(false)
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

  React.useEffect(() => {
    if (hydrated || bot === undefined) return
    const { nodes: n, edges: e } = graphToFlow(bot?.graph ?? DEFAULT_GRAPH)
    setNodes(n)
    setEdges(e)
    setHydrated(true)
  }, [bot, hydrated, setNodes, setEdges])

  /* El nodo de inicio no vive en el JSON del grafo (START es solo un
     ancla de edges) -- se le inyecta la conexión real acá, sin pasar por
     graphToFlow/flowToGraph. */
  React.useEffect(() => {
    if (!hydrated || inboxes === undefined) return
    const primary = inboxes[0]
    setNodes((current) =>
      current.map((n) => {
        if (n.type === 'trigger') {
          return {
            ...n,
            data: {
              label: 'START',
              inboxName: primary?.name ?? null,
              phoneNumberId: primary?.phone_number_id ?? null,
            } satisfies TriggerNodeData,
          }
        }
        if (n.type === 'endpoint') {
          return {
            ...n,
            data: {
              label: 'END',
              phoneNumberId: primary?.phone_number_id ?? null,
            } satisfies EndpointNodeData,
          }
        }
        return n
      }),
    )
  }, [inboxes, hydrated, setNodes])

  const saveMutation = useMutation({
    mutationFn: () =>
      saveBot(accountId, bot?.name ?? 'Bot principal', flowToGraph(nodes, edges), notes),
    onSuccess: () => {
      setDirty(false)
      setNotes('')
      toast.success('Hilo guardado', { description: 'Los cambios ya están activos.' })
      queryClient.invalidateQueries({ queryKey: queryKeys.bot(accountId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.botVersions(accountId) })
    },
    onError: (e) => {
      toast.error(e instanceof ApiError ? e.message : 'No se pudo guardar el hilo')
    },
  })

  /**
   * Restaurar una versión no toca `hydrated` (ya está en true): si
   * dependiéramos de ese efecto para releer `bot`, la primera actualización
   * de la caché (todavía con los datos viejos, antes de que el refetch
   * resuelva) lo dejaría trabado. Más simple: pedir el bot de nuevo acá
   * mismo y pintar ese grafo directo en el lienzo.
   */
  async function handleVersionActivated() {
    const fresh = await getBot(accountId)
    if (fresh) {
      const { nodes: n, edges: e } = graphToFlow(fresh.graph)
      setNodes(n)
      setEdges(e)
    }
    setDirty(false)
    setNotes('')
    queryClient.setQueryData(['bot', accountId], fresh)
    queryClient.invalidateQueries({ queryKey: queryKeys.botVersions(accountId) })
  }

  const onConnect = React.useCallback(
    (connection: Connection) => {
      setDirty(true)
      setEdges((current) => {
        // cada nodo admite un solo edge de salida: conectar uno nuevo
        // reemplaza al anterior, en vez de dejar crear algo que el
        // compilador va a rechazar de todas formas.
        const withoutOldOutgoing = current.filter((e) => e.source !== connection.source)
        return addEdge({ ...connection, animated: true }, withoutOldOutgoing)
      })
    },
    [setEdges],
  )

  function handleAddNode() {
    const id = newAgentNodeId()
    const maxX = nodes.reduce((max, n) => Math.max(max, n.position.x), 0)
    setNodes((current) => [
      ...current,
      {
        id,
        type: 'agent',
        position: { x: maxX + 280, y: 260 },
        data: { systemPrompt: null, tools: null, memoryWindow: null } satisfies AgentNodeData,
      },
    ])
    setSelectedNodeId(id)
    setDirty(true)
  }

  function handleNodeClick(_: React.MouseEvent, node: Node) {
    setSelectedNodeId(
      node.type === 'agent' || node.type === 'trigger' || node.type === 'endpoint'
        ? node.id
        : null,
    )
    setTestChatOpen(false)
  }

  function handleNodeDataChange(nodeId: string, data: AgentNodeData) {
    setNodes((current) => current.map((n) => (n.id === nodeId ? { ...n, data } : n)))
    setDirty(true)
  }

  function handleDeleteNode(nodeId: string) {
    setNodes((current) => current.filter((n) => n.id !== nodeId))
    setEdges((current) => current.filter((e) => e.source !== nodeId && e.target !== nodeId))
    setSelectedNodeId(null)
    setDirty(true)
  }

  const selectedNode = nodes.find((n) => n.id === selectedNodeId)
  const graphPreview = React.useMemo(() => flowToGraph(nodes, edges), [nodes, edges])
  const agentCount = nodes.filter((n) => n.type === 'agent').length

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Barra de la pantalla: fuera del lienzo, no flotando encima */}
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-surface px-5">
        <h1 className="text-[15px] font-semibold tracking-tight">Flujo del bot</h1>
        <span className="tabular rounded-full bg-surface-2 px-2 py-0.5 text-xs text-muted-foreground">
          {agentCount} {agentCount === 1 ? 'nodo' : 'nodos'}
        </span>
        {bot && (
          <span className="text-xs text-muted-foreground">
            {bot.name} · v{bot.version}
          </span>
        )}
        {dirty && (
          <span className="flex items-center gap-1.5 text-xs font-medium text-status-pending">
            <span className="size-1.5 rounded-full bg-status-pending" />
            Sin guardar
          </span>
        )}

        <div className="ml-auto flex items-center gap-2">
          {dirty && (
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Notas de esta versión (opcional)"
              aria-label="Notas de esta versión"
              className="h-8 w-56 text-[13px]"
            />
          )}
          <Button variant="outline" size="sm" onClick={handleAddNode}>
            <Plus />
            Agregar nodo
          </Button>
          {canManageVersions && (
            <Button
              variant={testChatOpen ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => {
                setTestChatOpen((v) => !v)
                setSelectedNodeId(null)
                setShowJson(false)
              }}
              aria-pressed={testChatOpen}
            >
              <TestTube2 />
              Probar
            </Button>
          )}
          <Button
            variant={showJson ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => {
              setShowJson((v) => !v)
              setTestChatOpen(false)
            }}
            aria-pressed={showJson}
          >
            <Braces />
            JSON
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setVersionsOpen(true)}>
            <History />
            Versiones
          </Button>
          <Button
            size="sm"
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending || !dirty}
          >
            {saveMutation.isPending ? <Loader2 className="animate-spin" /> : <Save />}
            {saveMutation.isPending ? 'Guardando…' : 'Guardar'}
          </Button>
        </div>
      </header>

      {/* Aviso fijo, no flotante: hay que verlo antes de empezar a armar el flujo,
          no solo si se lo nota flotando sobre el canvas. */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border bg-surface-2 px-5 py-2 text-[12.5px] text-muted-foreground">
        <Info className="size-3.5 shrink-0" />
        <p>
          Cadena lineal: cada nodo se conecta a lo sumo a uno solo, sin ramas condicionales. El
          nodo de inicio es la conexión de WhatsApp — clic en cualquier nodo para editarlo.
        </p>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="relative min-h-0 min-w-0 flex-1">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={handleNodeClick}
            onPaneClick={() => setSelectedNodeId(null)}
            nodeTypes={nodeTypes}
            colorMode={resolved}
            proOptions={{ hideAttribution: true }}
            fitView
            fitViewOptions={{ padding: 0.3, maxZoom: 1 }}
          >
            <Background variant={BackgroundVariant.Dots} gap={18} size={1.4} />
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
                <span className="ml-2 font-normal text-muted-foreground">
                  bot_versions.graph
                </span>
              </h2>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setShowJson(false)}
                aria-label="Cerrar JSON"
              >
                <X />
              </Button>
            </header>
            <pre className="min-h-0 flex-1 overflow-auto p-4 font-mono text-[11.5px] leading-relaxed text-muted-foreground">
              {JSON.stringify(graphPreview, null, 2)}
            </pre>
          </aside>
        )}

        {testChatOpen && !selectedNode && (
          <TestChatPanel accountId={accountId} onClose={() => setTestChatOpen(false)} />
        )}

        {selectedNode?.type === 'agent' && (
          <NodeEditPanel
            accountId={accountId}
            nodeId={selectedNode.id}
            data={selectedNode.data as AgentNodeData}
            availableTools={availableTools ?? []}
            onChange={(data) => handleNodeDataChange(selectedNode.id, data)}
            onDelete={() => handleDeleteNode(selectedNode.id)}
            onClose={() => setSelectedNodeId(null)}
          />
        )}

        {selectedNode?.type === 'trigger' && (
          <InboxConnectionPanel
            accountId={accountId}
            inboxes={inboxes ?? []}
            onClose={() => setSelectedNodeId(null)}
          />
        )}

        {selectedNode?.type === 'endpoint' && (
          <OutputConfigPanel
            accountId={accountId}
            inbox={inboxes?.[0]}
            onClose={() => setSelectedNodeId(null)}
          />
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
