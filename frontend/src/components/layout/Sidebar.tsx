import { useQuery } from '@tanstack/react-query'
import {
  Check,
  ChevronsUpDown,
  LogOut,
  MessagesSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Settings,
  Users,
  UsersRound,
  Workflow,
  type LucideIcon,
} from 'lucide-react'
import * as React from 'react'
import { NavLink, useNavigate } from 'react-router-dom'

import { Logo } from '@/components/Logo'
import { NewAccountDialog } from '@/components/NewAccountDialog'
import { ThemeToggle } from '@/components/ThemeToggle'
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
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useAuth } from '@/lib/auth'
import { getAccounts, getStats } from '@/lib/endpoints'
import { isAdmin, ROLE_LABEL } from '@/lib/roles'
import { queryKeys } from '@/lib/queryKeys'
import { cn } from '@/lib/utils'

const COLLAPSE_KEY = 'telar-sidebar-collapsed'

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
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [collapsed, setCollapsed] = React.useState(
    () => localStorage.getItem(COLLAPSE_KEY) === '1',
  )
  const [creatingAccount, setCreatingAccount] = React.useState(false)

  // Navegar (cambiar de sección, de cuenta, cerrar sesión) cierra el
  // drawer en mobile -- en desktop `mobileOpen` no se usa para nada, así
  // que esto no tiene efecto ahí.
  function closeMobile() {
    onMobileOpenChange(false)
  }

  const { data: accounts } = useQuery({ queryKey: queryKeys.accounts(), queryFn: getAccounts })
  const { data: stats } = useQuery({
    queryKey: queryKeys.stats(accountId),
    queryFn: () => getStats(accountId),
    refetchInterval: 8000,
  })

  function toggleCollapsed() {
    setCollapsed((prev) => {
      localStorage.setItem(COLLAPSE_KEY, prev ? '0' : '1')
      return !prev
    })
  }

  const currentAccount = accounts?.find((a) => a.id === accountId)

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

  function handleLogout() {
    logout()
    navigate('/login')
    closeMobile()
  }

  return (
    <>
      {/* Backdrop del drawer -- lg:hidden porque en desktop nunca hay
          overlay, el sidebar ya está siempre en flujo normal. */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-[2px] lg:hidden"
          onClick={closeMobile}
          aria-hidden
        />
      )}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-[260px] shrink-0 flex-col gap-1 border-r border-border bg-surface px-3 transition-transform duration-200',
          'lg:static lg:inset-y-auto lg:z-auto lg:translate-x-0 lg:transition-[width]',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
          collapsed ? 'lg:w-[60px] lg:px-2' : 'lg:w-[232px] lg:px-3',
        )}
      >
      {/* Marca */}
      <div className={cn('flex h-14 items-center', collapsed ? 'justify-center' : 'gap-2 px-1')}>
        {collapsed ? (
          <Logo variant="mark" size={26} />
        ) : (
          <>
            <Logo variant="horizontal" size={22} />
            <Button
              variant="ghost"
              size="icon-sm"
              className="ml-auto"
              onClick={toggleCollapsed}
              aria-label="Contraer menú"
            >
              <PanelLeftClose />
            </Button>
          </>
        )}
      </div>

      {collapsed && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className="mx-auto"
              onClick={toggleCollapsed}
              aria-label="Expandir menú"
            >
              <PanelLeftOpen />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">Expandir menú</TooltipContent>
        </Tooltip>
      )}

      {/* Cuenta */}
      {!collapsed && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="mt-1 flex w-full items-center gap-2 rounded-lg border border-border px-2.5 py-2 text-left transition-colors hover:bg-surface-2"
              aria-label="Cambiar de cuenta"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium">
                  {currentAccount?.name ?? 'Cuenta'}
                </p>
                {role && (
                  <p className="truncate text-[11px] text-muted-foreground">{ROLE_LABEL[role] ?? role}</p>
                )}
              </div>
              <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-[208px]">
            <DropdownMenuLabel>Cuentas</DropdownMenuLabel>
            {accounts?.map((account) => (
              <DropdownMenuItem
                key={account.id}
                onSelect={() => {
                  navigate(`/accounts/${account.id}/conversations`)
                  closeMobile()
                }}
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
                    setCreatingAccount(true)
                    closeMobile()
                  }}
                >
                  <Plus />
                  Crear cuenta
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {/* Navegación */}
      <nav className={cn('mt-3 flex flex-col', collapsed ? 'gap-1.5' : 'gap-0.5')} aria-label="Secciones">
        {items.map((item) => (
          <NavItemLink key={item.to} item={item} collapsed={collapsed} onNavigate={closeMobile} />
        ))}
      </nav>

      {/* Pie */}
      <div
        className={cn(
          'mt-auto flex flex-col gap-1 border-t border-border py-3',
          collapsed && 'items-center',
        )}
      >
        <ThemeToggle collapsed={collapsed} />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className={cn(
                'flex items-center gap-2.5 rounded-lg py-1.5 text-left transition-colors hover:bg-surface-2',
                collapsed ? 'justify-center px-1' : 'px-1.5',
              )}
              aria-label="Menú de usuario"
            >
              <ContactAvatar seed={user?.id ?? ''} name={user?.name} size="sm" />
              {!collapsed && (
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium">{user?.name}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {user?.email}
                  </span>
                </span>
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="top" className="w-56">
            <DropdownMenuLabel className="font-normal">
              <span className="block text-sm font-medium text-foreground">{user?.name}</span>
              <span className="block truncate text-xs text-muted-foreground">{user?.email}</span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => {
                navigate('/accounts')
                closeMobile()
              }}
            >
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

      <NewAccountDialog open={creatingAccount} onOpenChange={setCreatingAccount} />
      </aside>
    </>
  )
}

function NavItemLink({
  item,
  collapsed,
  onNavigate,
}: {
  item: NavItem
  collapsed: boolean
  onNavigate: () => void
}) {
  const { icon: Icon, label, to, badge } = item

  const link = (
    <NavLink
      to={to}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          'relative flex items-center rounded-lg text-[13px] font-medium transition-colors duration-150',
          collapsed ? 'size-9 justify-center' : 'gap-2.5 px-2.5 py-2',
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
              className="absolute top-1/2 -left-[13px] h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-primary"
            />
          )}
          <Icon className="size-[18px] shrink-0" />
          {!collapsed && <span className="flex-1 truncate">{label}</span>}
          {!collapsed && !!badge && (
            <span className="tabular rounded-full bg-status-pending-soft px-1.5 py-0.5 text-[11px] font-semibold text-status-pending">
              {badge}
            </span>
          )}
          {collapsed && !!badge && (
            <span
              aria-hidden
              className="absolute top-1 right-1 size-2 rounded-full bg-status-pending ring-2 ring-surface"
            />
          )}
        </>
      )}
    </NavLink>
  )

  if (!collapsed) return link

  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right">
        {label}
        {!!badge && ` · ${badge} pendientes`}
      </TooltipContent>
    </Tooltip>
  )
}
