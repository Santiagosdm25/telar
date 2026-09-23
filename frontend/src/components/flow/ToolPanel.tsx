import { AlertTriangle, Bot, Trash2, X } from 'lucide-react'
import { Link } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { ToolNodeData } from '@/lib/flowGraph'
import { toolIcon, toolKindLabel } from '@/lib/toolMeta'

interface Props {
  accountId: string
  data: ToolNodeData
  /** Agentes conectados a esta herramienta. */
  usedBy: { id: string; name: string }[]
  onSelect: (nodeId: string) => void
  onRemove: () => void
  onClose: () => void
}

export function ToolPanel({ accountId, data, usedBy, onSelect, onRemove, onClose }: Props) {
  const Icon = data.missing ? AlertTriangle : toolIcon(data.name, data.kind)
  const configurable = data.kind !== 'system'

  return (
    <aside className="flex h-full w-[320px] shrink-0 flex-col border-l border-border bg-surface">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4">
        <Icon className={data.missing ? 'size-4 text-destructive' : 'size-4 text-status-resolved'} />
        <h2 className="min-w-0 flex-1 truncate font-mono text-[13px] font-semibold">{data.name}</h2>
        <Badge variant="secondary">{toolKindLabel(data.kind)}</Badge>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Cerrar panel">
          <X />
        </Button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 py-4">
        {data.missing ? (
          <p className="rounded-lg bg-destructive-soft px-3 py-2.5 text-[12px] leading-relaxed text-destructive">
            Esta herramienta ya no existe en la cuenta (se borró o se renombró en Configuración).
            Los agentes la ignoran; sacala del lienzo o volvé a crearla.
          </p>
        ) : (
          <div className="flex flex-col gap-1">
            <span className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
              Qué hace
            </span>
            <p className="text-[12.5px] leading-relaxed">
              {data.description || 'Sin descripción.'}
            </p>
            <p className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">
              El agente lee esta descripción para decidir cuándo usarla: si la usa mal, ajustala
              {configurable ? ' en Configuración' : ''}.
            </p>
          </div>
        )}

        <div className="flex flex-col gap-2">
          <span className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
            La usan
          </span>
          {usedBy.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-3 py-3 text-xs leading-relaxed text-muted-foreground">
              Ningún agente todavía. Arrastrá desde el punto verde de abajo de un agente hasta esta
              herramienta.
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {usedBy.map((agent) => (
                <li key={agent.id}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded-lg border border-border px-2.5 py-1.5 text-left text-[12.5px] hover:bg-surface-2"
                    onClick={() => onSelect(agent.id)}
                  >
                    <Bot className="size-3.5 shrink-0 text-primary" />
                    {agent.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {configurable && (
          <Link
            to={`/accounts/${accountId}/settings`}
            className="text-[12px] text-primary underline-offset-2 hover:underline"
          >
            Editar en Configuración → Herramientas
          </Link>
        )}
      </div>

      <div className="shrink-0 border-t border-border p-3">
        <Button variant="destructive-ghost" size="sm" onClick={onRemove} className="w-full">
          <Trash2 />
          Sacar del lienzo
        </Button>
      </div>
    </aside>
  )
}
