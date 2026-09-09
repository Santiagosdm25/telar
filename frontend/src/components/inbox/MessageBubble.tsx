import {
  AlertTriangle,
  Bot,
  Check,
  CheckCheck,
  Clock,
  FileText,
  Image as ImageIcon,
  Info,
  Music,
  Video,
} from 'lucide-react'

import { clockTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { MessageMedia, MessageResponse } from '@/types/api'

/**
 * El backend todavía no descarga el archivo de Meta (ver
 * channels/meta.py:download_media, nunca se llama) -- `storage_url` va a
 * ser null siempre por ahora. Mientras tanto, mostrar tipo + nombre de
 * archivo es mejor que el placeholder genérico "[image recibido]".
 */
const MEDIA_LABEL: Record<string, string> = {
  image: 'Imagen',
  audio: 'Audio',
  video: 'Video',
  document: 'Documento',
  sticker: 'Sticker',
}

function MediaChip({ media, type }: { media: MessageMedia; type: string }) {
  const mime = media.mime_type
  const Icon = mime?.startsWith('image/')
    ? ImageIcon
    : mime?.startsWith('audio/')
      ? Music
      : mime?.startsWith('video/')
        ? Video
        : FileText
  const label = media.filename ?? MEDIA_LABEL[type] ?? 'Archivo adjunto'

  return (
    <div className="flex items-center gap-2 rounded-lg bg-black/[0.06] px-2.5 py-2 dark:bg-white/[0.06]">
      <Icon className="size-4 shrink-0 opacity-70" />
      <span className="min-w-0 truncate text-[13px] font-medium">{label}</span>
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
              <MediaChip media={message.media} type={message.type} />
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
