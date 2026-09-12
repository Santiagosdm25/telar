import { useQuery } from '@tanstack/react-query'
import { FileText, Send, X } from 'lucide-react'
import { Link } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { HelpTooltip } from '@/components/ui/help-tooltip'
import { getTemplates } from '@/lib/endpoints'
import { queryKeys } from '@/lib/queryKeys'
import type { InboxResponse } from '@/types/api'

interface Props {
  accountId: string
  inbox: InboxResponse | undefined
  onClose: () => void
}

/**
 * Panel del nodo de salida. A diferencia de un nodo "send message" de n8n,
 * acá no hay Recurso/Operación/Cuerpo para elegir: el agente genera el
 * texto y decide cuándo mandarlo (agent/compiler.py), así que casi todo
 * este panel es informativo -- lo único real y editable son las
 * plantillas, con las que sí se puede salir de la ventana de 24h.
 */
export function OutputConfigPanel({ accountId, inbox, onClose }: Props) {
  const { data: templates } = useQuery({
    queryKey: queryKeys.templates(accountId),
    queryFn: () => getTemplates(accountId),
  })

  return (
    <aside className="flex h-full w-[320px] shrink-0 flex-col border-l border-border bg-surface">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4">
        <Send className="size-4 text-muted-foreground" />
        <h2 className="min-w-0 flex-1 truncate text-[13px] font-semibold">Salida de WhatsApp</h2>
        <HelpTooltip>
          Este nodo no tiene un "cuerpo" fijo para escribir: el modelo arma el texto en cada
          turno, según el prompt y las tools del nodo agente que lo precede.
        </HelpTooltip>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Cerrar panel">
          <X />
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <dl className="flex flex-col gap-3">
          <Field label="Recurso" value="Mensajes de WhatsApp" />
          <Field label="Operación" value="Responder al contacto" />
          <Field label="Número remitente" value={inbox?.phone_number_id ?? 'Sin conectar'} mono />
          <Field label="Número destinatario" value="El mismo contacto que escribió" />
          <Field
            label="Tipo de mensaje"
            value="Texto libre, generado por el agente (dentro de la ventana de 24h)"
          />
        </dl>

        <div className="mt-5 border-t border-border pt-4">
          <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
            <FileText className="size-3" />
            Fuera de la ventana de 24h
            <HelpTooltip>
              El agente no puede mandar texto libre. Hoy la conversación se transfiere a un
              asesor en vez de mandar una plantilla sola -- llenar los parámetros de una
              plantilla es decisión de un humano, no algo que el agente resuelva solo todavía.
            </HelpTooltip>
          </div>
          {templates && templates.length > 0 ? (
            <p className="mt-2 text-[11.5px] text-muted-foreground">
              {templates.length} {templates.length === 1 ? 'plantilla registrada' : 'plantillas registradas'}{' '}
              para responder manualmente desde la bandeja.
            </p>
          ) : (
            <p className="mt-2 text-[11.5px] text-muted-foreground">
              Todavía no hay plantillas registradas en esta cuenta.
            </p>
          )}
          <Link
            to={`/accounts/${accountId}/settings`}
            className="mt-2 inline-block text-[11.5px] text-primary underline-offset-2 hover:underline"
          >
            Gestionar plantillas en Configuración
          </Link>
        </div>
      </div>
    </aside>
  )
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </dt>
      <dd className={mono ? 'font-mono text-[12.5px]' : 'text-[12.5px] text-foreground'}>
        {value}
      </dd>
    </div>
  )
}
