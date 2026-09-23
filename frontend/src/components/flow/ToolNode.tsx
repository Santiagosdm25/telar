import { Handle, Position, type NodeProps } from '@xyflow/react'
import { AlertTriangle } from 'lucide-react'

import { HANDLE, type ToolNodeData } from '@/lib/flowGraph'
import { toolIcon, toolKindLabel } from '@/lib/toolMeta'
import { cn } from '@/lib/utils'

/** Herramienta: se conecta desde abajo de uno o varios agentes. */
export function ToolNode({ data, selected }: NodeProps & { data: ToolNodeData }) {
  const Icon = data.missing ? AlertTriangle : toolIcon(data.name, data.kind)

  return (
    <div
      className={cn(
        'w-44 rounded-lg border bg-surface text-left shadow-panel transition-[border-color,box-shadow] duration-150',
        data.missing ? 'border-destructive/50' : 'border-border',
        selected && 'border-primary ring-[3px] ring-primary/25',
        !selected && 'hover:border-border-strong',
        data.active && 'ring-[3px] ring-status-resolved/50',
      )}
    >
      <Handle
        id={HANDLE.in}
        type="target"
        position={Position.Top}
        className="!size-3 !border-2 !border-background !bg-status-resolved"
      />
      <div className="flex items-center gap-2 px-2.5 py-2">
        <span
          className={cn(
            'grid size-6 shrink-0 place-items-center rounded-md',
            data.missing ? 'bg-destructive-soft text-destructive' : 'bg-status-resolved-soft text-status-resolved',
          )}
        >
          <Icon className="size-3.5" />
        </span>
        <span className="min-w-0">
          <span className="block truncate font-mono text-[11.5px] font-medium">{data.name}</span>
          <span className="block truncate text-[10.5px] text-muted-foreground">
            {data.missing ? 'Ya no existe en la cuenta' : toolKindLabel(data.kind)}
          </span>
        </span>
      </div>
    </div>
  )
}
