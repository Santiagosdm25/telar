import { useQuery } from '@tanstack/react-query'
import * as React from 'react'

import { getConversations } from '@/lib/endpoints'

const BASE_TITLE = document.title

/**
 * Consulta propia (una fila, sin filtro) porque el polling de la bandeja se pausa
 * en segundo plano y depende del filtro activo.
 */
export function useNewMessageTitleAlert(accountId: string | undefined) {
  const [unseen, setUnseen] = React.useState(0)
  const lastSeenRef = React.useRef<string | null>(null)
  const activeRef = React.useRef(true)

  const { data } = useQuery({
    queryKey: ['conversations', 'latest-activity', accountId],
    queryFn: () => getConversations(accountId!, undefined, { limit: 1 }),
    enabled: !!accountId,
    refetchInterval: 8000,
    refetchIntervalInBackground: true,
    staleTime: 0,
  })

  const latest = data?.[0]?.last_contact_message_at ?? null

  // Compara contra la última marca vista, no contra la cantidad.
  React.useEffect(() => {
    if (!latest) return
    if (lastSeenRef.current === null) {
      lastSeenRef.current = latest // primera carga: fija la base, no alerta
      return
    }
    if (latest === lastSeenRef.current) return
    lastSeenRef.current = latest
    if (!activeRef.current) setUnseen((n) => n + 1)
  }, [latest])

  // Una ventana de fondo puede estar visible sin foco: se piden ambas.
  React.useEffect(() => {
    function update() {
      const nowActive = document.visibilityState === 'visible' && document.hasFocus()
      activeRef.current = nowActive
      if (nowActive) setUnseen(0)
    }
    update()
    document.addEventListener('visibilitychange', update)
    window.addEventListener('focus', update)
    window.addEventListener('blur', update)
    return () => {
      document.removeEventListener('visibilitychange', update)
      window.removeEventListener('focus', update)
      window.removeEventListener('blur', update)
    }
  }, [])

  React.useEffect(() => {
    document.title = unseen > 0 ? `(${unseen}) ${BASE_TITLE}` : BASE_TITLE
    return () => {
      document.title = BASE_TITLE
    }
  }, [unseen])
}
