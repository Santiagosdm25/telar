import { useQuery } from '@tanstack/react-query'
import {
  AlertTriangle,
  Bot,
  Check,
  CheckCheck,
  Clock,
  Download,
  FileText,
  Image as ImageIcon,
  Info,
  Loader2,
  Music,
  Video,
} from 'lucide-react'
import { useParams } from 'react-router-dom'

import { fetchMessageMedia } from '@/lib/endpoints'
import { clockTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { MessageMedia, MessageResponse } from '@/types/api'

const MEDIA_LABEL: Record<string, string> = {
  image: 'Imagen',
  audio: 'Audio',
  video: 'Video',
  document: 'Documento',
  sticker: 'Sticker',
}

/**
 * `media.storage_url` (en realidad solo una marca "ya está guardado", no
 * una URL real -- ver channels/meta.py) es lo que dice si vale la pena
 * pedir el archivo. Si el mensaje es de antes de esta función, o la
 * descarga falló en su momento (Meta caída, archivo vencido, muy pesado),
 * no hay nada que traer: se queda en el chip con el nombre nomás.
 *
 * El objeto URL creado con el blob no se libera explícitamente al
 * desmontar -- vive hasta que se recarga la pestaña. Para el volumen de
 * media de una bandeja de soporte no vale la pena la complejidad de
 * trackear la revocación por ahora.
 */
function MediaChip({ media, type, messageId }: { media: MessageMedia; type: string; messageId: string }) {
  const { accountId, conversationId } = useParams<{ accountId: string; conversationId: string }>()
  const mime = media.mime_type
  const isImage = mime?.startsWith('image/') ?? false
  const isAudio = mime?.startsWith('audio/') ?? false
  const isVideo = mime?.startsWith('video/') ?? false

  const { data: objectUrl, isLoading, isError } = useQuery({
    queryKey: ['message-media', messageId],
    queryFn: async () => {
      const blob = await fetchMessageMedia(accountId!, conversationId!, messageId)
      return URL.createObjectURL(blob)
    },
    enabled: !!media.storage_url && !!accountId && !!conversationId,
    staleTime: Infinity,
    retry: false,
  })

  const Icon = isImage ? ImageIcon : isAudio ? Music : isVideo ? Video : FileText
  const label = media.filename ?? MEDIA_LABEL[type] ?? 'Archivo adjunto'

  if (isImage && objectUrl) {
    return (
      <a
        href={objectUrl}
        target="_blank"
        rel="noreferrer"
        className="block max-w-[280px] overflow-hidden rounded-lg"
      >
        <img src={objectUrl} alt={media.caption ?? label} className="max-h-[320px] w-full object-cover" />
      </a>
    )
  }

  if (isAudio && objectUrl) {
    // eslint-disable-next-line jsx-a11y/media-has-caption -- es contenido de un contacto, no hay caption que pedirle
    return <audio controls src={objectUrl} className="h-10 max-w-[280px]" />
  }

  if (isVideo && objectUrl) {
    return <video controls src={objectUrl} className="max-h-[320px] max-w-[280px] rounded-lg" />
  }

  return (
    <div className="flex items-center gap-2 rounded-lg bg-black/[0.06] px-2.5 py-2 dark:bg-white/[0.06]">
      <Icon className="size-4 shrink-0 opacity-70" />
      <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{label}</span>
      {isLoading && <Loader2 className="size-3.5 shrink-0 animate-spin opacity-60" />}
      {isError && (
        <span className="shrink-0 text-[11px] text-muted-foreground">no disponible</span>
      )}
      {objectUrl && (
        <a
          href={objectUrl}
          download={media.filename ?? undefined}
          aria-label={`Descargar ${label}`}
          className="shrink-0 opacity-70 hover:opacity-100"
        >
          <Download className="size-3.5" />
        </a>
      )}
    </div>
  )
}

export interface BubbleProps {
  message: MessageResponse
  /** El anterior es del mismo autor y cercano en el tiempo: agrupamos. */
  grouped?: boolean
}

/**
 * Tres orígenes, tres tratamientos visuales. Distinguir bot de asesor es lo
 * más importante de esta pantalla: quien audita una conversación necesita ver
 * de un vistazo qué dijo la IA y qué dijo una persona.
 */
export function MessageBubble({ message, grouped = false }: BubbleProps) {
  const { sender_type: sender } = message

  if (sender === 'system') {
    return (
      <div className="flex justify-center py-1">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-3 py-1 text-[11px] text-muted-foreground">
          <Info className="size-3" />
          {message.content ?? message.type}
        </span>
      </div>
    )
  }

  const fromContact = sender === 'contact'
  const isBot = sender === 'bot'

  return (
    <div
      className={cn(
        'flex flex-col',
        grouped ? 'mt-0.5' : 'mt-3',
        fromContact ? 'items-start' : 'items-end',
      )}
    >
      {!grouped && !fromContact && (
        <span className="mb-1 flex items-center gap-1 px-1 text-[11px] font-medium text-muted-foreground">
          {isBot ? (
            <>
              <Bot className="size-3" />
              Agente IA
            </>
          ) : (
            'Asesor'
          )}
        </span>
      )}

      <div
        className={cn(
          'group flex max-w-[min(560px,80%)] items-end gap-2',
          fromContact ? 'flex-row' : 'flex-row-reverse',
        )}
      >
        <div
          className={cn(
            'rounded-2xl px-3.5 py-2 text-sm leading-relaxed whitespace-pre-wrap',
            fromContact && 'rounded-bl-md bg-bubble-in text-bubble-in-foreground',
            !fromContact && 'rounded-br-md',
            isBot && 'border border-border-strong bg-bubble-bot text-foreground',
            sender === 'agent' && 'bg-bubble-out text-bubble-out-foreground',
            grouped && (fromContact ? 'rounded-bl-2xl' : 'rounded-br-2xl'),
          )}
        >
          {message.media ? (
            <div className="flex flex-col gap-1.5">
              <MediaChip media={message.media} type={message.type} messageId={message.id} />
              {/* Si no hay caption real, content es el placeholder genérico
                  que arma as_agent_text() en el backend -- no se repite. */}
              {message.content && !/^\[\w+ recibido\]$/.test(message.content) && (
                <p>{message.content}</p>
              )}
            </div>
          ) : (
            (message.content ?? (
              <span className="text-muted-foreground italic">[{message.type}]</span>
            ))
          )}
        </div>
        <div
          className={cn(
            'flex shrink-0 items-center gap-1 pb-1 text-[11px] text-muted-foreground transition-opacity',
            message.delivery_status === 'failed'
              ? 'opacity-100'
              : 'opacity-0 group-hover:opacity-100',
          )}
        >
          <time dateTime={message.created_at} className="tabular">
            {clockTime(message.created_at)}
          </time>
          {!fromContact && <DeliveryIndicator status={message.delivery_status} />}
        </div>
      </div>
    </div>
  )
}

/**
 * Solo tiene sentido para mensajes salientes (bot/asesor): un mensaje del
 * contacto siempre queda 'delivered' en la base apenas llega por webhook.
 */
function DeliveryIndicator({ status }: { status: string }) {
  switch (status) {
    case 'read':
      return <CheckCheck aria-label="Leído" className="size-3.5 text-primary" />
    case 'delivered':
      return <CheckCheck aria-label="Entregado" className="size-3.5" />
    case 'sent':
      return <Check aria-label="Enviado" className="size-3.5" />
    case 'failed':
      return <AlertTriangle aria-label="No se pudo enviar" className="size-3.5 text-destructive" />
    default:
      return <Clock aria-label="Enviando" className="size-3.5" />
  }
}

export function DaySeparator({ label }: { label: string }) {
  return (
    <div className="my-4 flex items-center gap-3">
      <span className="h-px flex-1 bg-border" />
      <span className="text-[11px] font-medium text-muted-foreground capitalize">{label}</span>
      <span className="h-px flex-1 bg-border" />
    </div>
  )
}
