import { WifiOff } from 'lucide-react'
import * as React from 'react'

import { getNetworkStatusSnapshot, subscribeNetworkStatus } from '@/lib/networkStatus'

/** El estado lo alimenta `apiFetch` en cada llamada: no hace polling propio. */
export function OfflineBanner() {
  const offline = React.useSyncExternalStore(subscribeNetworkStatus, getNetworkStatusSnapshot)

  if (!offline) return null

  return (
    <div
      role="status"
      className="flex shrink-0 items-center justify-center gap-2 border-b border-status-pending/25 bg-status-pending-soft px-3 py-1.5 text-[12.5px] font-medium text-status-pending"
    >
      <WifiOff className="size-3.5" />
      Sin conexión con el servidor -- reintentando…
    </div>
  )
}
