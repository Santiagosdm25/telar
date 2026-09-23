import { Handle, Position, type NodeProps } from '@xyflow/react'
import { Bot, Sparkles, Wrench } from 'lucide-react'

import { HANDLE, type AgentNodeData } from '@/lib/flowGraph'
import { cn } from '@/lib/utils'

const handleBase = '!size-3 !border-2 !border-background transition-transform hover:!scale-125'

/**
 * Agente del flujo. Dos puntos de conexión:
 * - entrada: a la izquierda en el principal (llega WhatsApp), arriba en un
 *   sub-agente (lo conecta el principal, igual que a una herramienta)
 * - abajo: arrastrar hasta lo que este agente puede usar — herramientas y,
 *   en el principal, sub-agentes. Nada de lo de abajo corre siempre: el
 *   agente decide en cada turno si lo usa.
 */
export function AgentNode({ data, selected }: NodeProps & { data: AgentNodeData }) {
  const isMain = data.role === 'main'
  const summary = isMain ? data.systemPrompt.trim() : data.description.trim()
  const toolCount = data.toolCount ?? 0
  const subCount = data.subCount ?? 0

  return (
    <div
      className={cn(
        'group relative w-64 rounded-xl border bg-surface text-left shadow-panel transition-[border-color,box-shadow] duration-150',
        isMain ? 'border-primary/50' : 'border-border',
        selected && 'border-primary ring-[3px] ring-primary/25',
        !selected && 'hover:border-border-strong',
        data.active && 'ring-[3px] ring-status-resolved/50',
      )}
    >
      <Handle
        id={HANDLE.in}
        type="target"
        position={isMain ? Position.Left : Position.Top}
        isConnectable={!isMain}
        className={cn(handleBase, isMain ? '!bg-border-strong' : '!bg-primary')}
      />

      <div
        className={cn(
          'flex items-center gap-2 rounded-t-xl border-b border-border px-3 py-2',
          isMain ? 'bg-primary-soft/60' : 'bg-surface-2/60',
        )}
      >
        <span
          className={cn(
            'grid size-6 shrink-0 place-items-center rounded-md',
            isMain ? 'bg-primary text-primary-foreground' : 'bg-primary-soft text-primary-soft-foreground',
          )}
        >
          {isMain ? <Sparkles className="size-3.5" /> : <Bot className="size-3.5" />}
        </span>
        <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold">{data.name}</span>
        <span className="shrink-0 text-[10.5px] font-medium text-muted-foreground">
          {isMain ? 'Principal' : 'Sub-agente · herramienta'}
        </span>
      </div>

      <div className="px-3 py-2.5">
        <p
          className={cn(
            'line-clamp-3 text-[12px] leading-relaxed',
            summary ? 'text-foreground' : 'text-muted-foreground italic',
          )}
        >
          {summary ||
            (isMain
              ? 'Habla con el cliente. Sin instrucciones propias: usa las de la cuenta.'
              : 'Falta describir cuándo lo llama el principal.')}
        </p>
        <div className="mt-2.5 flex items-center gap-3 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <Wrench className="size-3" />
            {toolCount === 0 ? 'Sin herramientas' : `${toolCount} ${toolCount === 1 ? 'herramienta' : 'herramientas'}`}
          </span>
          {isMain && subCount > 0 && (
            <span className="flex items-center gap-1.5">
              <Bot className="size-3" />
              {subCount} {subCount === 1 ? 'sub-agente' : 'sub-agentes'}
            </span>
          )}
        </div>
      </div>

      <Handle
        id={HANDLE.tools}
        type="source"
        position={Position.Bottom}
        className={cn(handleBase, '!bg-status-resolved')}
        title={
          isMain
            ? 'Arrastrá hasta una herramienta o un sub-agente que este agente pueda usar'
            : 'Arrastrá hasta una herramienta que este sub-agente pueda usar'
        }
      />
    </div>
  )
}
