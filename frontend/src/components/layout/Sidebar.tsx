import { useQuery } from '@tanstack/react-query'
import {
  Check,
  ChevronsUpDown,
  LogOut,
  MessagesSquare,
  MoonStar,
  Pin,
  PinOff,
  Plus,
  Settings,
  Sun,
  Users,
  UsersRound,
  Workflow,
  X,
  type LucideIcon,
} from 'lucide-react'
import * as React from 'react'
import { NavLink, useNavigate } from 'react-router-dom'

import { Logo } from '@/components/Logo'
import { NewAccountDialog } from '@/components/NewAccountDialog'
import { ContactAvatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { DesktopSidebar, MobileSidebar, SidebarLabel, useSidebar } from '@/components/ui/sidebar'
import { useAuth } from '@/lib/auth'
import { getAccounts, getStats } from '@/lib/endpoints'
import { isAdmin, ROLE_LABEL } from '@/lib/roles'
import { queryKeys } from '@/lib/queryKeys'
import { useTheme } from '@/lib/theme'
import { cn } from '@/lib/utils'

// '0' = fijado abierto. Cualquier otro valor (o nada) = rail que se abre al pasar el mouse.
const COLLAPSE_KEY = 'telar-sidebar-collapsed'

function readPinned() {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === '0'
  } catch {
    return false
  }
}

interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  badge?: number
}

interface SidebarProps {
  accountId: string
  role: string | null
  /** Drawer en mobile: por debajo de `lg` el sidebar arranca oculto. */
  mobileOpen: boolean
  onMobileOpenChange: (open: boolean) => void
}

export function Sidebar({ accountId, role, mobileOpen, onMobileOpenChange }: SidebarProps) {
  const [pinned, setPinned] = React.useState(readPinned)
  const [menusOpen, setMenusOpen] = React.useState(0)
  const [creatingAccount, setCreatingAccount] = React.useState(false)

  function togglePinned() {
    setPinned((prev) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, prev ? '1' : '0')
      } catch {
        // sin storage (modo privado): el cambio vale solo para esta sesión
      }
      return !prev
    })
  }

  // Los dropdowns se renderizan en un portal, fuera del panel: sin esto,
  // mover el mouse hacia el menú cerraría el sidebar debajo.
  const onMenuOpenChange = React.useCallback((open: boolean) => {
    setMenusOpen((n) => Math.max(0, n + (open ? 1 : -1)))
  }, [])

  const content = (mode: 'desktop' | 'mobile') => (
    <SidebarContent
      mode={mode}
      accountId={accountId}
      role={role}
      pinned={pinned}
      onTogglePinned={togglePinned}
      // En mobile el drawer se desmonta al navegar y el dropdown no avisa
      // que se cerró: el contador quedaría trabado y el panel de desktop
      // abierto al agrandar la ventana.
      onMenuOpenChange={mode === 'desktop' ? onMenuOpenChange : undefined}
      onCreateAccount={() => setCreatingAccount(true)}
      onNavigate={() => onMobileOpenChange(false)}
    />
  )

  return (
    <>
      <DesktopSidebar pinned={pinned} holdOpen={menusOpen > 0}>
        {content('desktop')}
      </DesktopSidebar>
      <MobileSidebar open={mobileOpen} onOpenChange={onMobileOpenChange}>
        {content('mobile')}
      </MobileSidebar>
      <NewAccountDialog open={creatingAccount} onOpenChange={setCreatingAccount} />
    </>
  )
}

interface SidebarContentProps {
  mode: 'desktop' | 'mobile'
  accountId: string
  role: string | null
  pinned: boolean
  onTogglePinned: () => void
  onMenuOpenChange?: (open: boolean) => void
  onCreateAccount: () => void
  /** Cierra el drawer en mobile; en desktop no tiene efecto. */
  onNavigate: () => void
}

function SidebarContent({
  mode,
  accountId,
  role,
  pinned,
  onTogglePinned,
  onMenuOpenChange,
  onCreateAccount,
  onNavigate,
}: SidebarContentProps) {
  const { open } = useSidebar()
  const { user, logout } = useAuth()
  const { resolved: theme, toggle: toggleTheme } = useTheme()
  const navigate = useNavigate()

  const { data: accounts } = useQuery({ queryKey: queryKeys.accounts(), queryFn: getAccounts })
  const { data: stats } = useQuery({
    queryKey: queryKeys.stats(accountId),
    queryFn: () => getStats(accountId),
    refetchInterval: 8000,
  })

  const currentAccount = accounts?.find((a) => a.id === accountId)
  const accountName = currentAccount?.name ?? 'Cuenta'

  const items: NavItem[] = [
    {
      to: `/accounts/${accountId}/conversations`,
      label: 'Conversaciones',
      icon: MessagesSquare,
      badge: stats?.pending,
    },
    { to: `/accounts/${accountId}/contacts`, label: 'Contactos', icon: Users },
    { to: `/accounts/${accountId}/team`, label: 'Equipo', icon: UsersRound },
    ...(isAdmin(role)
      ? [
          { to: `/accounts/${accountId}/bot`, label: 'Flujo del bot', icon: Workflow },
          { to: `/accounts/${accountId}/settings`, label: 'Configuración', icon: Settings },
        ]
      : []),
  ]

  function go(to: string) {
    navigate(to)
    onNavigate()
  }

  function handleLogout() {
    logout()
    go('/login')
  }

  const ThemeIcon = theme === 'dark' ? Sun : MoonStar

  return (
    <>
      {/* Marca */}
      <div className="flex h-14 shrink-0 items-center gap-2 pl-1">
        {open ? <Logo variant="horizontal" size={22} /> : <Logo variant="mark" size={22} />}
        {mode === 'desktop' && open && (
          <Button
            variant="ghost"
            size="icon-sm"
            className="ml-auto text-muted-foreground"
            onClick={onTogglePinned}
            aria-label={pinned ? 'Soltar menú' : 'Fijar menú abierto'}
            title={pinned ? 'Soltar menú' : 'Fijar menú abierto'}
          >
            {pinned ? <PinOff /> : <Pin />}
          </Button>
        )}
        {mode === 'mobile' && (
          <Button
            variant="ghost"
            size="icon-sm"
            className="ml-auto"
            onClick={onNavigate}
            aria-label="Cerrar menú"
          >
            <X />
          </Button>
        )}
      </div>

      {/* Cuenta */}
      <DropdownMenu onOpenChange={onMenuOpenChange}>
        <DropdownMenuTrigger asChild>
          <button
            className="mt-1 flex h-11 w-full shrink-0 items-center gap-2.5 rounded-lg text-left transition-colors hover:bg-surface-2"
            aria-label={`Cuenta: ${accountName}. Cambiar de cuenta`}
          >
            <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-border bg-surface-2 text-[13px] font-semibold uppercase">
              {accountName.charAt(0)}
            </span>
            <SidebarLabel className="flex-1">
              <span className="block truncate text-[13px] font-medium">{accountName}</span>
              {role && (
                <span className="block truncate text-[11px] text-muted-foreground">
                  {ROLE_LABEL[role] ?? role}
                </span>
              )}
            </SidebarLabel>
            <SidebarLabel className="pr-2">
              <ChevronsUpDown className="size-3.5 text-muted-foreground" />
            </SidebarLabel>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side={open ? 'bottom' : 'right'} className="w-[208px]">
          <DropdownMenuLabel>Cuentas</DropdownMenuLabel>
          {accounts?.map((account) => (
            <DropdownMenuItem
              key={account.id}
              onSelect={() => go(`/accounts/${account.id}/conversations`)}
            >
              <span className="flex-1 truncate">{account.name}</span>
              {account.id === accountId && <Check className="size-4 text-primary" />}
            </DropdownMenuItem>
          ))}
          {user?.is_superadmin && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => {
                  onCreateAccount()
                  onNavigate()
                }}
              >
                <Plus />
                Crear cuenta
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Navegación */}
      <nav className="mt-3 flex flex-col gap-0.5" aria-label="Secciones">
        {items.map((item) => (
          <NavItemLink key={item.to} item={item} onNavigate={onNavigate} />
        ))}
      </nav>

      {/* Pie */}
      <div className="mt-auto flex flex-col gap-1 border-t border-border py-3">
        <button
          onClick={toggleTheme}
          className="flex h-9 items-center gap-2.5 rounded-lg px-[9px] text-[13px] font-medium text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
          aria-label={theme === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
        >
          <ThemeIcon className="size-[18px] shrink-0" />
          <SidebarLabel>{theme === 'dark' ? 'Modo claro' : 'Modo oscuro'}</SidebarLabel>
        </button>

        <DropdownMenu onOpenChange={onMenuOpenChange}>
          <DropdownMenuTrigger asChild>
            <button
              className="flex items-center gap-2.5 rounded-lg px-1 py-1.5 text-left transition-colors hover:bg-surface-2"
              aria-label="Menú de usuario"
            >
              <ContactAvatar seed={user?.id ?? ''} name={user?.name} size="sm" />
              <SidebarLabel className="flex-1">
                <span className="block truncate text-[13px] font-medium">{user?.name}</span>
                <span className="block truncate text-[11px] text-muted-foreground">{user?.email}</span>
              </SidebarLabel>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side={open ? 'top' : 'right'} className="w-56">
            <DropdownMenuLabel className="font-normal">
              <span className="block text-sm font-medium text-foreground">{user?.name}</span>
              <span className="block truncate text-xs text-muted-foreground">{user?.email}</span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => go('/accounts')}>
              <ChevronsUpDown />
              Cambiar de cuenta
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onSelect={handleLogout}>
              <LogOut />
              Cerrar sesión
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </>
  )
}

function NavItemLink({ item, onNavigate }: { item: NavItem; onNavigate: () => void }) {
  const { open } = useSidebar()
  const { icon: Icon, label, to, badge } = item

  return (
    <NavLink
      to={to}
      onClick={onNavigate}
      aria-label={badge ? `${label}, ${badge} pendientes` : undefined}
      className={({ isActive }) =>
        cn(
          'relative flex h-9 items-center gap-2.5 rounded-lg px-[9px] text-[13px] font-medium transition-colors duration-150',
          isActive
            ? 'bg-primary-soft text-primary-soft-foreground'
            : 'text-muted-foreground hover:bg-surface-2 hover:text-foreground',
        )
      }
    >
      {({ isActive }) => (
        <>
          {/* barra de estado activo: no dependemos solo del color de fondo */}
          {isActive && (
            <span
              aria-hidden
              className="absolute top-1/2 -left-3 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-primary"
            />
          )}
          <span className="relative shrink-0">
            <Icon className="size-[18px]" />
            {!open && !!badge && (
              <span
                aria-hidden
                className="absolute -top-1 -right-1 size-2 rounded-full bg-status-pending ring-2 ring-surface"
              />
            )}
          </span>
          <SidebarLabel className="flex-1 truncate">{label}</SidebarLabel>
          {!!badge && (
            <SidebarLabel>
              <span className="tabular rounded-full bg-status-pending-soft px-1.5 py-0.5 text-[11px] font-semibold text-status-pending">
                {badge}
              </span>
            </SidebarLabel>
          )}
        </>
      )}
    </NavLink>
  )
}
