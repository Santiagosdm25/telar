import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  CheckCheck,
  ChevronUp,
  Clock,
  FileText,
  Hand,
  Info,
  Loader2,
  Lock,
  MessageSquareDashed,
  Undo2,
} from 'lucide-react'
import * as React from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'

import { EmptyState } from '@/components/EmptyState'
import { AssigneePicker } from '@/components/inbox/AssigneePicker'
import { Composer } from '@/components/inbox/Composer'
import { ContactInfoDialog, ContactPanel } from '@/components/inbox/ContactPanel'
import { DaySeparator, MessageBubble } from '@/components/inbox/MessageBubble'
import { SendTemplateDialog } from '@/components/inbox/SendTemplateDialog'
import { StatusBadge } from '@/components/StatusBadge'
import { ContactAvatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ApiError } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import {
  assignConversation,
  getConversationDetail,
  getMembers,
  PAGE_SIZE,
  releaseConversation,
  resolveConversation,
  sendMessage,
} from '@/lib/endpoints'
import { dayKey, dayLabel, formatPhone } from '@/lib/format'
import { isElevated } from '@/lib/roles'
import { queryKeys } from '@/lib/queryKeys'
import { serviceWindow } from '@/lib/serviceWindow'
import type { MessageResponse } from '@/types/api'

/** Dos mensajes seguidos del mismo autor dentro de 3 minutos se agrupan. */
const GROUP_WINDOW_MS = 3 * 60 * 1000

export function ThreadPage() {
  const { accountId, conversationId } = useParams<{
    accountId: string
    conversationId: string
  }>()
  const { user, roleForAccount } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [busy, setBusy] = React.useState(false)
  const [templateDialogOpen, setTemplateDialogOpen] = React.useState(false)
  const [contactInfoOpen, setContactInfoOpen] = React.useState(false)
  const bottomRef = React.useRef<HTMLDivElement>(null)

  const [olderMessages, setOlderMessages] = React.useState<MessageResponse[]>([])
  const [loadingOlder, setLoadingOlder] = React.useState(false)
  const [hasMoreOlder, setHasMoreOlder] = React.useState<boolean | null>(null)
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const scrollAdjustRef = React.useRef<number | null>(null)

  const { data: conv, isLoading } = useQuery({
    queryKey: queryKeys.conversation(accountId!, conversationId!),
    queryFn: () => getConversationDetail(accountId!, conversationId!),
    enabled: !!accountId && !!conversationId,
    // Con historial viejo cargado, un refresco puede correr el límite y dejar un hueco.
    refetchInterval: olderMessages.length === 0 ? 5000 : false,
  })

  /* Sin esto, cambiar de hilo mostraría mensajes de la conversación anterior. */
  React.useEffect(() => {
    setOlderMessages([])
    setHasMoreOlder(null)
  }, [conversationId])

  const allMessages = React.useMemo(
    () => [...olderMessages, ...(conv?.messages ?? [])],
    [olderMessages, conv],
  )

  async function loadOlderMessages() {
    if (!accountId || !conversationId || loadingOlder) return
    const oldest = allMessages[0]
    if (!oldest) return

    setLoadingOlder(true)
    try {
      const older = await getConversationDetail(accountId, conversationId, {
        before: oldest.created_at,
        limit: PAGE_SIZE,
      })
      // El contenido se inserta arriba: sin esto, la lista "salta".
      scrollAdjustRef.current = scrollRef.current?.scrollHeight ?? null
      setOlderMessages((prev) => [...older.messages, ...prev])
      setHasMoreOlder(older.messages.length >= PAGE_SIZE)
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'No se pudieron cargar los mensajes anteriores')
    } finally {
      setLoadingOlder(false)
    }
  }

  React.useLayoutEffect(() => {
    const container = scrollRef.current
    const previousHeight = scrollAdjustRef.current
    if (container && previousHeight != null) {
      container.scrollTop += container.scrollHeight - previousHeight
      scrollAdjustRef.current = null
    }
  }, [olderMessages])

  const role = accountId ? roleForAccount(accountId) : null
  const canOverride = isElevated(role)

  const { data: members } = useQuery({
    queryKey: queryKeys.members(accountId!),
    queryFn: () => getMembers(accountId!),
    enabled: !!accountId,
    staleTime: 60_000,
  })

  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [conv?.messages.length, conversationId])

  const invalidate = React.useCallback(() => {
    queryClient.invalidateQueries({ queryKey: queryKeys.conversation(accountId!, conversationId!) })
    queryClient.invalidateQueries({ queryKey: queryKeys.conversations.byAccount(accountId!) })
    queryClient.invalidateQueries({ queryKey: queryKeys.stats(accountId!) })
  }, [queryClient, accountId, conversationId])

  const runAction = React.useCallback(
    async (fallback: string, action: () => Promise<unknown>, success?: string) => {
      setBusy(true)
      try {
        await action()
        invalidate()
        if (success) toast.success(success)
      } catch (e) {
        toast.error(e instanceof ApiError ? e.message : fallback)
      } finally {
        setBusy(false)
      }
    },
    [invalidate],
  )

  if (!accountId || !conversationId) return null
  if (isLoading || !conv) return <ThreadSkeleton />

  const contactName = conv.contact_name ?? formatPhone(conv.contact_phone) ?? 'Sin nombre'
  const isMine = conv.assignee_id === user?.id
  const canWrite = conv.status === 'open' && (isMine || canOverride)

  const assignee = members?.find((m) => m.user_id === conv.assignee_id)
  const assigneeName = conv.assignee_id
    ? isMine
      ? `${user?.name} (vos)`
      : (assignee?.name ?? 'Otro asesor')
    : null

  const sw = serviceWindow(conv.last_contact_message_at)

  /* El backend solo exige ser dueño (o rol elevado) con la conversación 'open';
     en otro estado cualquiera de la cuenta puede reabrir con una plantilla. */
  const canSendTemplate = conv.status !== 'open' || isMine || canOverride

  async function handleSend(text: string) {
    try {
      await sendMessage(accountId!, conversationId!, text)
      invalidate()
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'No se pudo enviar el mensaje')
      throw e
    }
  }

  function assign(assigneeId?: string) {
    const target = assigneeId ? members?.find((m) => m.user_id === assigneeId)?.name : null
    runAction(
      'No se pudo asignar la conversación',
      () => assignConversation(accountId!, conversationId!, assigneeId),
      target ? `Asignada a ${target}` : 'Tomaste la conversación',
    )
  }

  return (
    <div className="flex min-w-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col bg-background">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-surface px-4">
          <Button
            variant="ghost"
            size="icon-sm"
            className="-ml-1 shrink-0 lg:hidden"
            aria-label="Volver a la lista"
            onClick={() => navigate(`/accounts/${accountId}/conversations`)}
          >
            <ArrowLeft />
          </Button>
          <ContactAvatar seed={conv.contact_id} name={conv.contact_name} size="md" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm leading-tight font-semibold">{contactName}</p>
            <p className="tabular truncate font-mono text-[11px] text-muted-foreground">
              {formatPhone(conv.contact_phone)}
            </p>
          </div>

          {/* En xl el panel derecho ya muestra el estado. */}
          <StatusBadge
            status={conv.status}
            size="sm"
            className="hidden shrink-0 sm:inline-flex xl:hidden"
          />

          <Button
            variant="ghost"
            size="icon-sm"
            className="shrink-0 xl:hidden"
            title="Datos del contacto"
            aria-label="Datos del contacto"
            onClick={() => setContactInfoOpen(true)}
          >
            <Info />
          </Button>

          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
            {conv.status !== 'open' && (
              <Button size="sm" disabled={busy} onClick={() => assign()} aria-label="Tomar">
                <Hand />
                <span className="hidden sm:inline">Tomar</span>
              </Button>
            )}

            {canOverride && (
              <AssigneePicker
                accountId={accountId}
                assigneeId={conv.assignee_id}
                disabled={busy}
                onAssign={assign}
              />
            )}

            {conv.status === 'open' && isMine && (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  aria-label="Devolver a la cola"
                  onClick={() =>
                    runAction(
                      'No se pudo devolver a la cola',
                      () => releaseConversation(accountId, conversationId),
                      'Volvió a la cola',
                    )
                  }
                >
                  <Undo2 />
                  <span className="hidden sm:inline">Devolver</span>
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  aria-label="Resolver"
                  onClick={() =>
                    runAction(
                      'No se pudo resolver',
                      () => resolveConversation(accountId, conversationId),
                      'Conversación resuelta',
                    )
                  }
                >
                  <CheckCheck />
                  <span className="hidden sm:inline">Resolver</span>
                </Button>
              </>
            )}
          </div>
        </header>

        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {allMessages.length === 0 ? (
            <EmptyState
              icon={MessageSquareDashed}
              title="Todavía no hay mensajes"
              description="Cuando el contacto escriba, o cuando el agente responda, los mensajes aparecen acá."
            />
          ) : (
            <div className="mx-auto max-w-3xl">
              {(hasMoreOlder ?? conv.messages.length >= PAGE_SIZE) && (
                <div className="mb-4 flex justify-center">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={loadingOlder}
                    onClick={loadOlderMessages}
                  >
                    {loadingOlder ? <Loader2 className="animate-spin" /> : <ChevronUp />}
                    {loadingOlder ? 'Cargando…' : 'Cargar mensajes anteriores'}
                  </Button>
                </div>
              )}
              {hasMoreOlder === false && (
                <p className="mb-4 text-center text-[11px] text-muted-foreground">
                  Ya viste todo el historial de esta conversación.
                </p>
              )}
              {groupMessages(allMessages).map((entry) =>
                entry.kind === 'day' ? (
                  <DaySeparator key={`day-${entry.key}`} label={entry.label} />
                ) : (
                  <MessageBubble
                    key={entry.message.id}
                    message={entry.message}
                    grouped={entry.grouped}
                  />
                ),
              )}
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {!sw.open && canSendTemplate && (
          <div className="flex items-center gap-3 border-t border-border bg-surface px-4 py-2.5">
            <Clock className="size-4 shrink-0 text-status-pending" />
            <p className="flex-1 text-[12.5px] text-muted-foreground">
              {sw.never
                ? 'Este contacto todavía no escribió: no hay ventana de servicio para abrir.'
                : 'Ventana de 24 horas cerrada.'}{' '}
              Para reabrirla hace falta una plantilla aprobada por Meta.
            </p>
            <Button variant="outline" size="xs" onClick={() => setTemplateDialogOpen(true)}>
              <FileText />
              Enviar plantilla
            </Button>
          </div>
        )}

        {canWrite ? (
          <Composer onSend={handleSend} contactName={contactName} window={sw} />
        ) : (
          <LockedComposer
            status={conv.status}
            busy={busy}
            canTake={conv.status !== 'open'}
            takenByOther={conv.status === 'open' && !isMine}
            assigneeName={assignee?.name}
            onTake={() => assign()}
          />
        )}
      </div>

      <SendTemplateDialog
        accountId={accountId}
        conversationId={conversationId}
        open={templateDialogOpen}
        onOpenChange={setTemplateDialogOpen}
        onSent={invalidate}
      />

      <ContactPanel
        conversation={conv}
        contactName={contactName}
        contactPhone={conv.contact_phone}
        assigneeName={assigneeName}
        serviceWindow={sw}
        messagesLoaded={allMessages.length}
      />

      <ContactInfoDialog
        open={contactInfoOpen}
        onOpenChange={setContactInfoOpen}
        conversation={conv}
        contactName={contactName}
        contactPhone={conv.contact_phone}
        assigneeName={assigneeName}
        serviceWindow={sw}
        messagesLoaded={allMessages.length}
      />
    </div>
  )
}

function LockedComposer({
  status,
  busy,
  canTake,
  takenByOther,
  assigneeName,
  onTake,
}: {
  status: string
  busy: boolean
  canTake: boolean
  takenByOther: boolean
  assigneeName?: string
  onTake: () => void
}) {
  const message = takenByOther
    ? `Esta conversación la tiene ${assigneeName ?? 'otro asesor'}.`
    : status === 'bot'
      ? 'El agente de IA está atendiendo. Si la tomás, la IA deja de responder.'
      : status === 'pending'
        ? 'El cliente pidió hablar con una persona y nadie la tomó todavía.'
        : 'La conversación está cerrada. Tomala si necesitás retomar el contacto.'

  return (
    <div className="flex items-center gap-3 border-t border-border bg-surface px-4 py-3.5">
      <Lock className="size-4 shrink-0 text-muted-foreground" />
      <p className="flex-1 text-[13px] text-muted-foreground">{message}</p>
      {canTake && (
        <Button size="sm" disabled={busy} onClick={onTake}>
          <Hand />
          Tomar y responder
        </Button>
      )}
    </div>
  )
}

type Entry =
  | { kind: 'day'; key: string; label: string }
  | { kind: 'message'; message: MessageResponse; grouped: boolean }

function groupMessages(messages: MessageResponse[]): Entry[] {
  const entries: Entry[] = []
  let lastDay: string | null = null
  let previous: MessageResponse | null = null

  for (const message of messages) {
    const key = dayKey(message.created_at)
    if (key !== lastDay) {
      entries.push({ kind: 'day', key, label: dayLabel(message.created_at) })
      lastDay = key
      previous = null
    }

    const grouped =
      !!previous &&
      previous.sender_type === message.sender_type &&
      message.sender_type !== 'system' &&
      new Date(message.created_at).getTime() - new Date(previous.created_at).getTime() <
        GROUP_WINDOW_MS

    entries.push({ kind: 'message', message, grouped })
    previous = message
  }

  return entries
}

function ThreadSkeleton() {
  return (
    <div className="flex min-w-0 flex-1 flex-col bg-background">
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-surface px-4">
        <Skeleton className="size-9 rounded-full" />
        <div className="space-y-2">
          <Skeleton className="h-3.5 w-32" />
          <Skeleton className="h-2.5 w-24" />
        </div>
      </div>
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 p-6">
        <Skeleton className="h-12 w-64 rounded-2xl" />
        <Skeleton className="h-16 w-80 self-end rounded-2xl" />
        <Skeleton className="h-10 w-52 rounded-2xl" />
        <Skeleton className="h-12 w-72 self-end rounded-2xl" />
      </div>
    </div>
  )
}
