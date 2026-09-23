import { useMutation } from '@tanstack/react-query'
import {
  AlertTriangle,
  ArrowRight,
  ChevronRight,
  CornerDownRight,
  Loader2,
  RotateCcw,
  Send,
  TestTube2,
  Wrench,
  X,
} from 'lucide-react'
import * as React from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ApiError } from '@/lib/api'
import { testChat } from '@/lib/endpoints'
import { cn } from '@/lib/utils'
import type { TraceEvent } from '@/types/api'

interface ChatMessage {
  id: string
  role: 'user' | 'bot' | 'system'
  text: string
  wouldEscalate?: boolean
  trace?: TraceEvent[]
}

interface Props {
  accountId: string
  /** id del agente → nombre visible, para contar la traza con los nombres del lienzo. */
  agentNames: Record<string, string>
  /** Qué actuó en el último turno, para resaltarlo en el lienzo. null = limpiar. */
  onTrace: (trace: TraceEvent[] | null) => void
  onClose: () => void
}

/**
 * Habla con el bot tal cual está configurado -- mismo grafo, tools y
 * modelo que en producción -- sin tocar contactos ni conversaciones
 * reales (ver POST /bot/test-chat). session_id se genera acá y se
 * mantiene mientras el panel esté abierto; "Reiniciar" lo tira y arranca
 * una sesión de prueba nueva, sin memoria del intercambio anterior.
 */
export function TestChatPanel({ accountId, agentNames, onTrace, onClose }: Props) {
  const [sessionId, setSessionId] = React.useState<string | null>(null)
  const [messages, setMessages] = React.useState<ChatMessage[]>([])
  const [input, setInput] = React.useState('')
  const listRef = React.useRef<HTMLDivElement>(null)

  const send = useMutation({
    mutationFn: (text: string) => testChat(accountId, { message: text, session_id: sessionId ?? undefined }),
    onSuccess: (result) => {
      setSessionId(result.session_id)
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: 'bot',
          text: result.reply,
          wouldEscalate: result.would_escalate,
          trace: result.trace,
        },
      ])
      onTrace(result.trace)
    },
    onError: (e) => {
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: 'system',
          text: e instanceof ApiError ? e.message : 'No se pudo hablar con el bot.',
        },
      ])
    },
  })

  React.useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [messages, send.isPending])

  function handleSend() {
    const text = input.trim()
    if (!text || send.isPending) return
    setMessages((current) => [...current, { id: crypto.randomUUID(), role: 'user', text }])
    setInput('')
    send.mutate(text)
  }

  function handleReset() {
    setSessionId(null)
    setMessages([])
    setInput('')
    onTrace(null)
  }

  return (
    <aside className="flex h-full w-[340px] shrink-0 flex-col border-l border-border bg-surface">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4">
        <TestTube2 className="size-4 text-muted-foreground" />
        <h2 className="min-w-0 flex-1 truncate text-[13px] font-semibold">Probar el bot</h2>
        <Button variant="ghost" size="icon-sm" onClick={handleReset} aria-label="Reiniciar sesión de prueba" title="Reiniciar">
          <RotateCcw />
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Cerrar panel">
          <X />
        </Button>
      </header>

      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {messages.length === 0 && (
          <p className="rounded-lg border border-dashed border-border px-3 py-3 text-[12px] leading-relaxed text-muted-foreground">
            Escribile como si fueras el cliente. Usa el flujo guardado (no los cambios sin guardar),
            con las mismas herramientas y modelo, sin crear conversaciones en la bandeja. Debajo de
            cada respuesta vas a ver qué agente actuó y qué herramientas usó.
          </p>
        )}
        <div className="flex flex-col gap-2.5">
          {messages.map((m) => (
            <div key={m.id} className={cn('flex flex-col gap-1', m.role === 'user' && 'items-end')}>
              <div
                className={cn(
                  'max-w-[85%] rounded-xl px-3 py-2 text-[13px] leading-relaxed whitespace-pre-wrap',
                  m.role === 'user' && 'bg-primary text-primary-foreground',
                  m.role === 'bot' && 'bg-surface-2 text-foreground',
                  m.role === 'system' && 'bg-destructive-soft text-destructive text-[12px]',
                )}
              >
                {m.text}
              </div>
              {m.trace && m.trace.length > 0 && <TraceView trace={m.trace} agentNames={agentNames} />}
              {m.wouldEscalate && (
                <span className="flex items-center gap-1 text-[11px] text-status-pending">
                  <AlertTriangle className="size-3" />
                  En producción, esto transfiere a un asesor
                </span>
              )}
            </div>
          ))}
          {send.isPending && (
            <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
              <Loader2 className="size-3 animate-spin" />
              Pensando…
            </div>
          )}
        </div>
      </div>

      <form
        className="flex shrink-0 items-center gap-2 border-t border-border p-3"
        onSubmit={(e) => {
          e.preventDefault()
          handleSend()
        }}
      >
        <Input
          autoFocus
          placeholder="Escribí un mensaje de prueba…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={send.isPending}
        />
        <Button type="submit" size="icon-sm" disabled={send.isPending || !input.trim()} aria-label="Enviar">
          <Send />
        </Button>
      </form>
    </aside>
  )
}

/**
 * "Qué pasó" en el turno, contado en orden. Se salta lo redundante: el
 * resultado de `delegar_*` es la misma respuesta del sub-agente, y el último
 * mensaje del principal es la respuesta que ya se ve arriba.
 */
function TraceView({ trace, agentNames }: { trace: TraceEvent[]; agentNames: Record<string, string> }) {
  const [open, setOpen] = React.useState(true)
  const name = (id: string) => agentNames[id] ?? id
  const lastMainMessage = trace.findLastIndex((e) => e.kind === 'message' && !isSubAgent(e.agent, trace))

  const steps = trace
    .map((e, i) => ({ e, i }))
    .filter(({ e, i }) => {
      if (e.kind === 'delegated') return false
      if (e.kind === 'tool_result' && e.name?.startsWith('delegar_')) return false
      if (e.kind === 'message' && i === lastMainMessage) return false
      return true
    })
  if (steps.length === 0) return null

  return (
    <div className="w-full max-w-[92%] rounded-lg border border-border bg-surface text-[11.5px]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left font-medium text-muted-foreground hover:text-foreground"
        aria-expanded={open}
      >
        <ChevronRight className={cn('size-3 transition-transform', open && 'rotate-90')} />
        Qué pasó · {steps.length} {steps.length === 1 ? 'paso' : 'pasos'}
      </button>
      {open && (
        <ol className="flex flex-col gap-1.5 border-t border-border px-2.5 py-2">
          {steps.map(({ e, i }) => (
            <li key={i} className={cn('leading-snug', isSubAgent(e.agent, trace) && 'pl-3')}>
              <TraceStep event={e} name={name} />
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

function TraceStep({ event: e, name }: { event: TraceEvent; name: (id: string) => string }) {
  if (e.kind === 'tool_call' && e.name?.startsWith('delegar_')) {
    const sub = e.name.slice('delegar_'.length)
    const task = typeof e.args?.tarea === 'string' ? e.args.tarea : ''
    return (
      <span className="flex flex-col gap-0.5">
        <span className="flex items-center gap-1 font-medium text-primary">
          {name(e.agent)} <ArrowRight className="size-3" /> {name(sub)}
        </span>
        {task && <span className="text-muted-foreground">“{task}”</span>}
      </span>
    )
  }
  if (e.kind === 'tool_call') {
    const args = e.args && Object.keys(e.args).length ? JSON.stringify(e.args) : ''
    return (
      <span className="flex flex-col gap-0.5">
        <span className="flex items-center gap-1">
          <Wrench className="size-3 shrink-0 text-status-resolved" />
          <span className="text-muted-foreground">{name(e.agent)} usa</span>
          <span className="font-mono font-medium">{e.name}</span>
        </span>
        {args && <span className="truncate font-mono text-[10.5px] text-muted-foreground">{args}</span>}
      </span>
    )
  }
  if (e.kind === 'tool_result') {
    return (
      <span className={cn('flex gap-1', e.error ? 'text-destructive' : 'text-muted-foreground')}>
        <CornerDownRight className="mt-0.5 size-3 shrink-0" />
        <span className="line-clamp-3">{e.text}</span>
      </span>
    )
  }
  if (e.kind === 'message') {
    return (
      <span className="flex flex-col gap-0.5">
        <span className="font-medium">{name(e.agent)} responde:</span>
        <span className="line-clamp-4 text-muted-foreground">{e.text}</span>
      </span>
    )
  }
  return (
    <span className="flex gap-1 text-destructive">
      <AlertTriangle className="mt-0.5 size-3 shrink-0" />
      {name(e.agent)}: {e.text}
    </span>
  )
}

function isSubAgent(agent: string, trace: TraceEvent[]) {
  return trace.some((e) => e.kind === 'delegated' && e.agent === agent)
}
