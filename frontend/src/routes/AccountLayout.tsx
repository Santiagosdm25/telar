import { Navigate, Outlet, useParams } from 'react-router-dom'

import { Logo } from '@/components/Logo'
import { OfflineBanner } from '@/components/layout/OfflineBanner'
import { Sidebar } from '@/components/layout/Sidebar'
import { useAuth } from '@/lib/auth'
import { MobileNavProvider, useMobileNav } from '@/lib/mobileNav'
import { useNewMessageTitleAlert } from '@/lib/useNewMessageTitleAlert'

export function AccountLayout() {
  const { accountId } = useParams<{ accountId: string }>()
  const { user, loading, roleForAccount } = useAuth()

  useNewMessageTitleAlert(accountId)

  if (loading) return <BootScreen />
  if (!user) return <Navigate to="/login" replace />
  if (!accountId) return <Navigate to="/" replace />

  return (
    <MobileNavProvider>
      <AccountLayoutBody accountId={accountId} role={roleForAccount(accountId)} />
    </MobileNavProvider>
  )
}

function AccountLayoutBody({ accountId, role }: { accountId: string; role: string | null }) {
  const { open, setOpen } = useMobileNav()

  return (
    <div className="flex h-svh flex-col overflow-hidden bg-background">
      <OfflineBanner />
      <div className="flex min-h-0 flex-1">
        <Sidebar accountId={accountId} role={role} mobileOpen={open} onMobileOpenChange={setOpen} />
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

/** Pantalla de arranque mientras se restaura la sesión: nunca un blanco vacío. */
export function BootScreen() {
  return (
    <div className="flex h-svh items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-3">
        <div className="animate-pulse">
          <Logo variant="mark" size={40} />
        </div>
        <span className="text-sm text-muted-foreground">Cargando Telar…</span>
      </div>
    </div>
  )
}
