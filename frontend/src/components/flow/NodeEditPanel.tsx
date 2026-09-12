import { useQuery } from '@tanstack/react-query'
import { Brain, Cpu, Trash2, Wrench, X } from 'lucide-react'
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
import { queryKeys } from '@/lib/queryKeys'
import type { AgentNodeData } from '@/lib/flowGraph'
import { cn } from '@/lib/utils'
import type { AvailableToolResponse } from '@/types/api'

interface Props {
  accountId: string
  nodeId: string
  data: AgentNodeData
  availableTools: AvailableToolResponse[]
  onChange: (data: AgentNodeData) => void
  onDelete: () => void
  onClose: () => void
}

export function NodeEditPanel({
  accountId,
  nodeId,
  data,
  availableTools,
  onChange,
  onDelete,
  onClose,
}: Props) {
  const selectedTools = data.tools // null = todas
  const label = nodeId.replace(/_\d{10,}_\d+$/, '')
  const memoryEnabled = data.memoryWindow !== null

  function toggleTool(name: string) {
    if (selectedTools === null) {
      // pasaba de "todas" a una lista explícita con todas menos la que se saca
      onChange({ ...data, tools: availableTools.map((t) => t.name).filter((n) => n !== name) })
      return
    }
    const next = selectedTools.includes(name)
      ? selectedTools.filter((n) => n !== name)
      : [...selectedTools, name]
    onChange({ ...data, tools: next })
  }

  return (
    <aside className="flex h-full w-[320px] shrink-0 flex-col border-l border-border bg-surface">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4">
        <h2 className="min-w-0 flex-1 truncate font-mono text-[13px] font-semibold">{label}</h2>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Cerrar panel">
          <X />
        </Button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 py-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="system-prompt" className="gap-1.5">
            Instrucciones
            <HelpTooltip>
              Lo que este nodo le dice al modelo. Si lo dejás vacío usa el prompt por defecto de
              la cuenta.
            </HelpTooltip>
          </Label>
          <Textarea
            id="system-prompt"
            className="mt-1 min-h-40 font-mono text-[12.5px] leading-relaxed"
            placeholder="Detectá qué necesita el cliente y clasificá el caso…"
            value={data.systemPrompt ?? ''}
            onChange={(e) => onChange({ ...data, systemPrompt: e.target.value })}
          />
        </div>

        <ModelSection accountId={accountId} />

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <Label className="gap-1.5">
              <Brain className="size-3.5 text-muted-foreground" />
              Memoria
              <HelpTooltip>
                Acorta lo que se le manda al modelo en este turno -- no borra nada de lo que ya
                se guardó de la conversación.
              </HelpTooltip>
            </Label>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() =>
                onChange({ ...data, memoryWindow: memoryEnabled ? null : 20 })
              }
            >
              {memoryEnabled ? 'Usar todo el historial' : 'Limitar'}
            </Button>
          </div>
          {memoryEnabled ? (
            <div className="flex items-center gap-2 rounded-lg border border-border px-3 py-2.5">
              <span className="text-[12px] text-muted-foreground">Últimos</span>
              <Input
                type="number"
                min={0}
                className="h-7 w-16 text-center font-mono text-[12.5px]"
                value={data.memoryWindow ?? 0}
                onChange={(e) =>
                  onChange({ ...data, memoryWindow: Math.max(0, Number(e.target.value) || 0) })
                }
              />
              <span className="text-[12px] text-muted-foreground">mensajes del hilo</span>
            </div>
          ) : (
            <p className="rounded-lg border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
              Este nodo ve toda la conversación guardada, sin cortar nada.
            </p>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <Label className="gap-1.5">
              <Wrench className="size-3.5 text-muted-foreground" />
              Tools
            </Label>
            <Button
              variant="ghost"
              size="xs"
              onClick={() => onChange({ ...data, tools: selectedTools === null ? [] : null })}
            >
              {selectedTools === null ? 'Elegir manualmente' : 'Usar todas'}
            </Button>
          </div>

          {selectedTools === null ? (
            <p className="rounded-lg border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
              Este nodo tiene disponibles todas las tools de la cuenta, incluidas las que agregues
              más adelante.
            </p>
          ) : availableTools.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
              La cuenta no tiene tools configuradas todavía.
            </p>
          ) : (
            <div className="flex flex-col gap-1">
              {availableTools.map((tool) => {
                const checked = selectedTools.includes(tool.name)
                return (
                  <label
                    key={tool.name}
                    className={cn(
                      'flex cursor-pointer items-start gap-2.5 rounded-lg border px-2.5 py-2 transition-colors',
                      checked
                        ? 'border-primary/40 bg-primary-soft/50'
                        : 'border-border hover:bg-surface-2',
                    )}
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5 size-3.5 accent-[var(--primary)]"
                      checked={checked}
                      onChange={() => toggleTool(tool.name)}
                    />
                    <span className="min-w-0">
                      <span className="block font-mono text-[12px] font-medium">{tool.name}</span>
                      <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">
                        {tool.description.split('\n')[0]}
                      </span>
                    </span>
                  </label>
                )
              })}
            </div>
          )}
        </div>
      </div>

      <div className="shrink-0 border-t border-border p-3">
        <Button variant="destructive-ghost" size="sm" onClick={onDelete} className="w-full">
          <Trash2 />
          Eliminar nodo
        </Button>
      </div>
    </aside>
  )
}

/**
 * El modelo es un ajuste de cuenta (llm_providers.is_active), no de este
 * nodo en particular -- todos los nodos "agent" de la cuenta lo comparten,
 * igual que ya pasaba antes de que este atajo existiera. Esto solo evita
 * tener que salir del lienzo para cambiarlo: reusa el mismo CRUD y el
 * mismo "Descubrir modelos" de Configuración → Proveedor LLM.
 */
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
          Es un ajuste de toda la cuenta, no de este nodo en particular -- todos los nodos que
          uses comparten el mismo modelo.
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
        <Link
          to={`/accounts/${accountId}/settings`}
          className="text-primary underline-offset-2 hover:underline"
        >
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
