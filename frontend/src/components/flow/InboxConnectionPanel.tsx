import { KeyRound, RadioTower, X } from 'lucide-react'
import * as React from 'react'
import { Link } from 'react-router-dom'

import { CreateInboxForm, EditInboxForm, RotateCredentialsForm } from '@/components/InboxConnectionForm'
import { Button } from '@/components/ui/button'
import { HelpTooltip } from '@/components/ui/help-tooltip'
import type { InboxResponse } from '@/types/api'

interface Props {
  accountId: string
  inboxes: InboxResponse[]
  onClose: () => void
}

/** Con más de un inbox solo edita el primero; el resto se gestiona en Configuración. */
export function InboxConnectionPanel({ accountId, inboxes, onClose }: Props) {
  const primary = inboxes[0] as InboxResponse | undefined
  const extraCount = Math.max(inboxes.length - 1, 0)

  return (
    <aside className="flex h-full w-[320px] shrink-0 flex-col border-l border-border bg-surface">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4">
        <RadioTower className="size-4 text-muted-foreground" />
        <h2 className="min-w-0 flex-1 truncate text-[13px] font-semibold">Conexión de WhatsApp</h2>
        <HelpTooltip>
          El hilo se dispara con cada mensaje nuevo que llega por este número. Los webhooks de
          estado (entregado, leído) se ignoran automáticamente -- no hay otros eventos para
          elegir todavía.
        </HelpTooltip>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Cerrar panel">
          <X />
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {primary ? (
          <ConnectedForm accountId={accountId} inbox={primary} />
        ) : (
          <CreateInboxForm
            accountId={accountId}
            helperText={
              <p className="text-xs text-muted-foreground">
                Todavía no hay ningún número de WhatsApp conectado a esta cuenta.
              </p>
            }
            onSuccess={() => {}}
            renderActions={({ pending, canSubmit }) => (
              <Button type="submit" size="sm" disabled={pending || !canSubmit}>
                Conectar
              </Button>
            )}
          />
        )}

        {extraCount > 0 && (
          <p className="mt-4 text-xs text-muted-foreground">
            +{extraCount} {extraCount === 1 ? 'inbox más' : 'inboxes más'} en esta cuenta.{' '}
            <Link
              to={`/accounts/${accountId}/settings`}
              className="text-primary underline-offset-2 hover:underline"
            >
              Gestionarlos en Configuración
            </Link>
          </p>
        )}
      </div>
    </aside>
  )
}

function ConnectedForm({ accountId, inbox }: { accountId: string; inbox: InboxResponse }) {
  const [rotating, setRotating] = React.useState(false)

  return (
    <div className="flex flex-col gap-5">
      <EditInboxForm
        accountId={accountId}
        inbox={inbox}
        renderActions={({ pending, canSubmit }) => (
          <Button type="submit" size="sm" variant="outline" disabled={pending || !canSubmit}>
            Guardar
          </Button>
        )}
      />

      <div className="border-t border-border pt-4">
        {!rotating ? (
          <div className="flex flex-col gap-2">
            <div className="flex flex-col gap-0.5">
              <span className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                phone_number_id
              </span>
              <span className="font-mono text-[12.5px]">{inbox.phone_number_id ?? '—'}</span>
            </div>
            {inbox.waba_id && (
              <div className="flex flex-col gap-0.5">
                <span className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                  waba_id
                </span>
                <span className="font-mono text-[12.5px]">{inbox.waba_id}</span>
              </div>
            )}
            <Button variant="ghost" size="xs" className="mt-1 self-start" onClick={() => setRotating(true)}>
              <KeyRound />
              Rotar credenciales
            </Button>
          </div>
        ) : (
          <RotateCredentialsForm
            accountId={accountId}
            inbox={inbox}
            helperText={
              <p className="text-xs text-muted-foreground">
                Reemplaza el número, el waba_id y el token juntos.
              </p>
            }
            onSuccess={() => setRotating(false)}
            renderActions={({ pending, canSubmit }) => (
              <div className="flex gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={() => setRotating(false)}>
                  Cancelar
                </Button>
                <Button type="submit" size="sm" disabled={pending || !canSubmit}>
                  Rotar
                </Button>
              </div>
            )}
          />
        )}
      </div>
    </div>
  )
}
