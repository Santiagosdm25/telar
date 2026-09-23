import { cn } from '@/lib/utils'
import type { ConversationStatusValue } from '@/types/api'

const STATUS = {
  bot: {
    label: 'Bot',
    hint: 'La IA está respondiendo',
    dot: 'bg-status-bot',
    chip: 'bg-status-bot-soft text-status-bot',
  },
  pending: {
    label: 'Esperando asesor',
    hint: 'Se pidió un humano; la IA ya dejó de responder',
    dot: 'bg-status-pending',
    chip: 'bg-status-pending-soft text-status-pending',
  },
  open: {
    label: 'Con asesor',
    hint: 'Un asesor la tiene tomada',
    dot: 'bg-status-open',
    chip: 'bg-status-open-soft text-status-open',
  },
  resolved: {
    label: 'Resuelta',
    hint: 'Cerrada; el próximo mensaje la reabre en bot',
    dot: 'bg-status-resolved',
    chip: 'bg-status-resolved-soft text-status-resolved',
  },
} as const satisfies Record<ConversationStatusValue, unknown>

export function statusLabel(status: ConversationStatusValue) {
  return STATUS[status].label
}

export function statusHint(status: ConversationStatusValue) {
  return STATUS[status].hint
}

/** Clases del chip "suave" de un estado: fondo tenue + texto en su color. */
export function statusChipClass(status: ConversationStatusValue) {
  return STATUS[status].chip
}

/** Punto de color solo: siempre acompañado de texto en algún lado. */
export function StatusDot({
  status,
  className,
}: {
  status: ConversationStatusValue
  className?: string
}) {
  return (
    <span
      aria-hidden
      className={cn('inline-block size-2 shrink-0 rounded-full', STATUS[status].dot, className)}
    />
  )
}

export function StatusBadge({
  status,
  className,
  size = 'default',
}: {
  status: ConversationStatusValue
  className?: string
  size?: 'default' | 'sm'
}) {
  const s = STATUS[status]
  return (
    <span
      className={cn(
        'inline-flex w-fit items-center gap-1.5 rounded-full font-medium whitespace-nowrap',
        s.chip,
        size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs',
        className,
      )}
    >
      <span aria-hidden className={cn('size-1.5 rounded-full', s.dot)} />
      {s.label}
    </span>
  )
}
