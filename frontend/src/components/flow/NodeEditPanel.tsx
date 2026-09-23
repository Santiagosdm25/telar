import { useQuery } from '@tanstack/react-query'
import { Bot, Brain, Cpu, Sparkles, Trash2, Unplug, Wrench, X } from 'lucide-react'
import * as React from 'react'
import { Link } from 'react-router-dom'

import { CreateProviderDialog } from '@/components/settings/providers/CreateProviderDialog'
import { EditProviderDialog } from '@/components/settings/providers/EditProviderDialog'
import { PROVIDER_LABEL } from '@/components/settings/providers/providerFormConstants'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { HelpTooltip } from '@/components/ui/help-tooltip'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { getLlmProviders } from '@/lib/endpoints'
import type { AgentNodeData, ToolNodeData } from '@/lib/flowGraph'
import { queryKeys } from '@/lib/queryKeys'
import { toolIcon } from '@/lib/toolMeta'
import { cn } from '@/lib/utils'

interface Props {
  accountId: string
  nodeId: string
  data: AgentNodeData
  connectedTools: ToolNodeData[]
  subagents: { id: string; name: string }[]
  onChange: (data: AgentNodeData) => void
  onRename: (name: string) => void
  onDisconnect: (targetId: string) => void
  onSelect: (nodeId: string) => void
  onDelete: () => void
  onClose: () => void
}

export function NodeEditPanel({
  accountId,
  nodeId,
  data,
  connectedTools,
  subagents,
  onChange,
  onRename,
  onDisconnect,
  onSelect,
  onDelete,
  onClose,
}: Props) {
  const isMain = data.role === 'main'
  const memoryEnabled = data.memoryWindow !== null

  return (
    <aside className="flex h-full w-[340px] shrink-0 flex-col border-l border-border bg-surface">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4">
        {isMain ? (
          <Sparkles className="size-4 text-primary" />
        ) : (
          <Bot className="size-4 text-muted-foreground" />
        )}
        <h2 className="min-w-0 flex-1 truncate text-[13px] font-semibold">{data.name}</h2>
        <Badge variant={isMain ? 'default' : 'secondary'}>{isMain ? 'Principal' : 'Sub-agente'}</Badge>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Cerrar panel">
          <X />
        </Button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 py-4">
        <p className="rounded-lg bg-surface-2 px-3 py-2.5 text-[12px] leading-relaxed text-muted-foreground">
          {isMain
            ? 'Es el único que habla con el cliente y ve toda la conversación. En cada mensaje decide si le hace falta alguna de sus herramientas o sub-agentes.'
            : 'Para el principal es una herramienta: lo llama solo cuando la conversación lo necesita. No habla con el cliente ni ve la conversación; recibe una tarea, usa sus herramientas y devuelve el resultado. Si le falta un dato, se lo pide al principal.'}
        </p>

        <NameField key={nodeId} name={data.name} onRename={onRename} />

        {!isMain && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="agent-description" className="gap-1.5">
              ¿Cuándo lo llama el principal?
              <HelpTooltip>
                El principal lee esto para decidir cuándo delegarle. Sé concreto: qué resuelve y
                qué datos necesita recibir.
              </HelpTooltip>
            </Label>
            <Textarea
              id="agent-description"
              className={cn(
                'min-h-20 text-[12.5px] leading-relaxed',
                !data.description.trim() && 'border-status-pending/60',
              )}
              placeholder="Cuando el cliente quiera cambiar datos sensibles. Necesita el número de documento; envía un código OTP y lo verifica."
              value={data.description}
              onChange={(e) => onChange({ ...data, description: e.target.value })}
            />
            {!data.description.trim() && (
              <p className="text-[11.5px] text-status-pending">Obligatorio para poder guardar.</p>
            )}
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="system-prompt" className="gap-1.5">
            Instrucciones
            <HelpTooltip>
              {isMain
                ? 'Cómo atiende al cliente: tono, qué puede resolver, cuándo transferir. Vacío = el prompt por defecto de la cuenta.'
                : 'Cómo hace su trabajo: pasos, qué herramienta usar primero, cómo informar el resultado.'}
            </HelpTooltip>
          </Label>
          <Textarea
            id="system-prompt"
            className="min-h-36 font-mono text-[12.5px] leading-relaxed"
            placeholder={
              isMain
                ? 'Sos el asistente de atención de la empresa. Respondé breve y claro…'
                : '1. Consultá el documento en la API de registro.\n2. Si está vigente, enviá el código OTP…'
            }
            value={data.systemPrompt}
            onChange={(e) => onChange({ ...data, systemPrompt: e.target.value })}
          />
        </div>

        <ModelSection accountId={accountId} />

        {isMain && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <Label className="gap-1.5">
                <Brain className="size-3.5 text-muted-foreground" />
                Memoria
                <HelpTooltip>
                  Cuántos mensajes recientes de la conversación ve el principal en cada turno. No
                  borra nada de lo guardado.
                </HelpTooltip>
              </Label>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={() => onChange({ ...data, memoryWindow: memoryEnabled ? null : 30 })}
              >
                {memoryEnabled ? 'Usar todo el historial' : 'Limitar'}
              </Button>
            </div>
            {memoryEnabled ? (
              <div className="flex items-center gap-2 rounded-lg border border-border px-3 py-2.5">
                <span className="text-[12px] text-muted-foreground">Últimos</span>
                <Input
                  type="number"
                  min={1}
                  className="h-7 w-16 text-center font-mono text-[12.5px]"
                  value={data.memoryWindow ?? ''}
                  onChange={(e) => {
                    const n = Number(e.target.value)
                    // Vacío o 0 dejaría al modelo sin ver ni el mensaje actual.
                    if (e.target.value !== '' && n >= 1) onChange({ ...data, memoryWindow: Math.floor(n) })
                  }}
                />
                <span className="text-[12px] text-muted-foreground">mensajes</span>
              </div>
            ) : (
              <p className="rounded-lg border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
                Ve toda la conversación. En chats largos es más caro y lento: conviene limitarlo.
              </p>
            )}
          </div>
        )}

        <div className="flex flex-col gap-2">
          <Label className="gap-1.5">
            <Wrench className="size-3.5 text-muted-foreground" />
            Herramientas conectadas
          </Label>
          {connectedTools.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-3 py-3 text-xs leading-relaxed text-muted-foreground">
              Arrastrá desde el punto <span className="font-medium text-status-resolved">verde</span> de
              abajo del agente hasta una herramienta. Si no está en el lienzo, sumala con{' '}
              <span className="font-medium text-foreground">Herramienta</span> arriba.
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {connectedTools.map((tool) => {
                const Icon = toolIcon(tool.name, tool.kind)
                return (
                  <li
                    key={tool.name}
                    className="flex items-center gap-2 rounded-lg border border-border px-2.5 py-1.5"
                  >
                    <Icon className="size-3.5 shrink-0 text-status-resolved" />
                    <button
                      type="button"
                      className="min-w-0 flex-1 truncate text-left font-mono text-[12px] hover:underline"
                      onClick={() => onSelect(`tool:${tool.name}`)}
                    >
                      {tool.name}
                    </button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => onDisconnect(`tool:${tool.name}`)}
                      aria-label={`Desconectar ${tool.name}`}
                      title="Desconectar"
                    >
                      <Unplug />
                    </Button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        {isMain && (
          <div className="flex flex-col gap-2">
            <Label className="gap-1.5">
              <Bot className="size-3.5 text-muted-foreground" />
              Sub-agentes que puede usar
              <HelpTooltip>
                Para el principal cada sub-agente es una herramienta más: lo llama solo cuando la
                conversación lo necesita, según su descripción. No corre en todos los mensajes.
              </HelpTooltip>
            </Label>
            {subagents.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border px-3 py-3 text-xs leading-relaxed text-muted-foreground">
                Sumá uno con <span className="font-medium text-foreground">Sub-agente</span> arriba, o
                arrastrá desde el punto <span className="font-medium text-status-resolved">verde</span> de
                abajo del principal hasta un sub-agente que ya esté en el lienzo.
              </p>
            ) : (
              <ul className="flex flex-col gap-1">
                {subagents.map((sub) => (
                  <li
                    key={sub.id}
                    className="flex items-center gap-2 rounded-lg border border-border px-2.5 py-1.5"
                  >
                    <Bot className="size-3.5 shrink-0 text-primary" />
                    <button
                      type="button"
                      className="min-w-0 flex-1 truncate text-left text-[12.5px] hover:underline"
                      onClick={() => onSelect(sub.id)}
                    >
                      {sub.name}
                    </button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => onDisconnect(sub.id)}
                      aria-label={`Dejar de delegar en ${sub.name}`}
                      title="Desconectar"
                    >
                      <Unplug />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {!isMain && (
        <div className="shrink-0 border-t border-border p-3">
          <Button variant="destructive-ghost" size="sm" onClick={onDelete} className="w-full">
            <Trash2 />
            Eliminar sub-agente
          </Button>
        </div>
      )}
    </aside>
  )
}

/**
 * Se confirma en blur/Enter, no en cada tecla: en un sub-agente el nombre define
 * el id, y cambiarlo en vivo le haría perder el foco al input. Montado con `key={nodeId}`.
 */
function NameField({ name, onRename }: { name: string; onRename: (name: string) => void }) {
  const [value, setValue] = React.useState(name)

  function commit() {
    const trimmed = value.trim()
    if (trimmed && trimmed !== name) onRename(trimmed)
    else setValue(name)
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="node-name">Nombre</Label>
      <Input
        id="node-name"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            e.currentTarget.blur()
          }
        }}
        className="text-[12.5px]"
      />
    </div>
  )
}

/** El modelo es un ajuste de la cuenta (llm_providers.is_active), compartido por todos los agentes. */
function ModelSection({ accountId }: { accountId: string }) {
  const [creating, setCreating] = React.useState(false)
  const [editing, setEditing] = React.useState(false)

  const { data: providers, isLoading } = useQuery({
    queryKey: queryKeys.llmProviders(accountId),
    queryFn: () => getLlmProviders(accountId),
  })

  const active = providers?.find((p) => p.is_active)

  return (
    <div className="flex flex-col gap-2">
      <Label className="gap-1.5">
        <Cpu className="size-3.5 text-muted-foreground" />
        Modelo
        <HelpTooltip>
          Es un ajuste de toda la cuenta: el principal y los sub-agentes usan el mismo modelo.
        </HelpTooltip>
      </Label>

      {isLoading ? (
        <p className="text-xs text-muted-foreground">Cargando…</p>
      ) : active ? (
        <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
          <div className="min-w-0">
            <p className="truncate text-[12.5px] font-medium">{active.name}</p>
            <p className="truncate font-mono text-[11px] text-muted-foreground">
              {PROVIDER_LABEL[active.provider]} · {active.model}
            </p>
          </div>
          <Button type="button" variant="outline" size="xs" onClick={() => setEditing(true)}>
            Cambiar
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-2 rounded-lg border border-dashed border-border px-3 py-3">
          <p className="text-xs text-muted-foreground">
            Sin proveedor activo: se usa el modelo por defecto de la plataforma.
          </p>
          <Button type="button" variant="outline" size="xs" className="self-start" onClick={() => setCreating(true)}>
            <Badge variant="secondary" className="mr-1">nuevo</Badge>
            Configurar un modelo
          </Button>
        </div>
      )}

      <p className="text-[11px] text-muted-foreground">
        <Link to={`/accounts/${accountId}/settings`} className="text-primary underline-offset-2 hover:underline">
          Ver todos en Configuración
        </Link>
      </p>

      <CreateProviderDialog accountId={accountId} open={creating} onOpenChange={setCreating} />
      <EditProviderDialog
        accountId={accountId}
        provider={editing ? (active ?? null) : null}
        onOpenChange={(open) => !open && setEditing(false)}
      />
    </div>
  )
}
