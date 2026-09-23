import { Handle, Position, type NodeProps } from '@xyflow/react'
import { RadioTower } from 'lucide-react'

import { cn } from '@/lib/utils'

export interface TriggerNodeData {
  [key: string]: unknown
  label: 'START'
  inboxName: string | null
  phoneNumberId: string | null
}

export function TriggerNode({ data, selected }: NodeProps & { data: TriggerNodeData }) {
  const connected = !!data.inboxName

  return (
    <div
      className={cn(
        'w-56 overflow-hidden rounded-xl border bg-surface text-left shadow-panel transition-[border-color,box-shadow] duration-150',
        selected ? 'border-primary ring-[3px] ring-primary/25' : 'border-border hover:border-border-strong',
      )}
    >
      <div className="flex items-center gap-2 border-b border-border bg-surface-2/60 px-3 py-2">
        <span
          className={cn(
            'grid size-6 shrink-0 place-items-center rounded-md',
            connected ? 'bg-status-open-soft text-status-open' : 'bg-surface-2 text-muted-foreground',
          )}
        >
          <RadioTower className="size-3.5" />
        </span>
        <span className="truncate text-[12px] font-medium">WhatsApp</span>
      </div>

      <div className="px-3 py-2.5">
        {connected ? (
          <>
            <p className="truncate text-[12px] font-medium text-foreground">{data.inboxName}</p>
            <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
              {data.phoneNumberId}
            </p>
          </>
        ) : (
          <p className="text-[12px] text-muted-foreground italic">Sin conectar — clic para configurar</p>
        )}
      </div>

      {/* Siempre conectado al agente principal: no se arrastra a mano. */}
      <Handle
        type="source"
        position={Position.Right}
        isConnectable={false}
        className="!size-2.5 !border-2 !border-background !bg-border-strong"
      />
    </div>
  )
}
