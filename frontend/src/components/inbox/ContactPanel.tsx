import { Check, Clock, Copy } from 'lucide-react'
import * as React from 'react'

import { StatusBadge, statusHint } from '@/components/StatusBadge'
import { ContactAvatar } from '@/components/ui/avatar'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { formatPhone } from '@/lib/format'
import type { ServiceWindow } from '@/lib/serviceWindow'
import { cn } from '@/lib/utils'
import type { ConversationDetailResponse } from '@/types/api'

interface ContactPanelProps {
  conversation: ConversationDetailResponse
  contactName: string
  contactPhone: string | null
  assigneeName?: string | null
  serviceWindow: ServiceWindow
  /** Incluye el historial viejo ya traído con "Cargar mensajes anteriores". */
  messagesLoaded: number
}

/** Aside fijo con los datos del contacto, visible desde el breakpoint xl para arriba. */
export function ContactPanel(props: ContactPanelProps) {
  return (
    <aside
      className="hidden w-[276px] shrink-0 flex-col overflow-y-auto border-l border-border bg-surface xl:flex"
      aria-label="Datos del contacto"
    >
      <ContactPanelBody {...props} />
    </aside>
  )
}

/** Mismos datos que ContactPanel, en un diálogo para pantallas por debajo de xl. */
export function ContactInfoDialog({
  open,
  onOpenChange,
  ...props
}: ContactPanelProps & { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] gap-0 overflow-y-auto p-0">
        <DialogHeader className="px-5 pt-5 pb-4">
          <DialogTitle>Datos del contacto</DialogTitle>
        </DialogHeader>
        <ContactPanelBody {...props} />
      </DialogContent>
    </Dialog>
  )
}

function ContactPanelBody({
  conversation,
  contactName,
  contactPhone,
  assigneeName,
  serviceWindow: sw,
  messagesLoaded,
}: ContactPanelProps) {
  return (
    <>
      <div className="flex flex-col items-center gap-3 border-b border-border px-5 py-6 text-center">
        {/* Sin fallback a teléfono: initials() ya cae a "?" y con dígitos daría "+6". */}
        <ContactAvatar seed={conversation.contact_id} name={conversation.contact_name} size="xl" />
        <div className="min-w-0">
          <p className="truncate font-semibold">{contactName}</p>
          <p className="tabular font-mono text-xs text-muted-foreground">
            {formatPhone(contactPhone)}
          </p>
        </div>
        <StatusBadge status={conversation.status} />
        <p className="text-xs text-muted-foreground">{statusHint(conversation.status)}</p>
      </div>

      <div className="border-b border-border px-5 py-4">
        <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
          Ventana de 24 horas
        </p>
        <p
          className={cn(
            'mt-1.5 flex items-center gap-1.5 text-[13px] font-medium',
            sw.open ? (sw.warning ? 'text-status-pending' : 'text-status-open') : 'text-status-pending',
          )}
        >
          <Clock className="size-3.5" />
          {sw.never ? 'Sin abrir' : sw.open ? `Abierta · ${sw.label}` : 'Cerrada'}
        </p>
        {sw.closesAt && sw.open && (
          <p className="mt-0.5 text-[11.5px] text-muted-foreground">
            Se cierra el{' '}
            {sw.closesAt.toLocaleString('es', {
              day: 'numeric',
              month: 'short',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </p>
        )}
      </div>

      <dl className="flex flex-col gap-3.5 px-5 py-5 text-sm">
        <Field label="Asesor asignado" value={assigneeName ?? 'Nadie'} />
        <Field label="ID de contacto" value={conversation.contact_id} mono copyable />
        <Field label="ID de conversación" value={conversation.id} mono copyable />
        <Field label="Mensajes cargados" value={String(messagesLoaded)} />
      </dl>
    </>
  )
}

function Field({
  label,
  value,
  mono,
  copyable,
}: {
  label: string
  value?: string | null
  mono?: boolean
  copyable?: boolean
}) {
  const [copied, setCopied] = React.useState(false)

  async function copy() {
    if (!value) return
    await navigator.clipboard.writeText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }

  return (
    <div>
      <dt className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </dt>
      <dd className="mt-0.5 flex items-start gap-1.5">
        <span
          className={
            mono
              ? 'min-w-0 flex-1 font-mono text-[11.5px] leading-snug break-all text-foreground'
              : 'min-w-0 flex-1 text-[13px] text-foreground'
          }
        >
          {value || '—'}
        </span>
        {copyable && value && (
          <button
            onClick={copy}
            aria-label={`Copiar ${label}`}
            className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
          >
            {copied ? <Check className="size-3.5 text-primary" /> : <Copy className="size-3.5" />}
          </button>
        )}
      </dd>
    </div>
  )
}
