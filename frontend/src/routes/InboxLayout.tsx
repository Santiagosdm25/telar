import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { Check, ChevronDown, Inbox, Loader2, RefreshCw, Search, X } from 'lucide-react'
import * as React from 'react'
import { Outlet, useNavigate, useParams } from 'react-router-dom'

import { EmptyState } from '@/components/EmptyState'
import { ConversationListItem } from '@/components/inbox/ConversationListItem'
import { MobileMenuButton } from '@/components/layout/MobileMenuButton'
import { StatusDot, statusChipClass } from '@/components/StatusBadge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Select } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useAuth } from '@/lib/auth'
import { getConversations, getStats, getTeams, PAGE_SIZE } from '@/lib/endpoints'
import { queryKeys } from '@/lib/queryKeys'
import { useDebouncedValue } from '@/lib/useDebouncedValue'
import { cn } from '@/lib/utils'
import type { ConversationStatusValue } from '@/types/api'

type Filter = ConversationStatusValue | 'all'

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'Todas' },
  { value: 'pending', label: 'Espera' },
  { value: 'open', label: 'Asesor' },
  { value: 'bot', label: 'Bot' },
  { value: 'resolved', label: 'Resueltas' },
]

export function InboxLayout() {
  const { accountId, conversationId } = useParams<{
    accountId: string
    conversationId?: string
  }>()
  const { user } = useAuth()
  const navigate = useNavigate()
  const [filter, setFilter] = React.useState<Filter>('all')
  const [teamId, setTeamId] = React.useState('')
  const [query, setQuery] = React.useState('')
  const debouncedQuery = useDebouncedValue(query.trim(), 300)
  const searchRef = React.useRef<HTMLInputElement>(null)

  /**
   * La API pagina con limit/offset y su default son 50. Sin esto la bandeja
   * se cortaba en la primera página sin ningún aviso.
   */
  const {
    data,
    isLoading,
    isFetching,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: queryKeys.conversations.list(accountId!, filter, teamId, debouncedQuery),
    queryFn: ({ pageParam }) =>
      getConversations(accountId!, filter === 'all' ? undefined : filter, {
        offset: pageParam,
        q: debouncedQuery || undefined,
        teamId: teamId || undefined,
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) =>
      (lastPage?.length ?? 0) < PAGE_SIZE ? undefined : allPages.length * PAGE_SIZE,
    enabled: !!accountId,
    // Un refresco de fondo vuelve a pedir TODAS las páginas cargadas, así que
    // con varias páginas se espacía en vez de darle la misma cadencia que a la
    // primera -- pero nunca se apaga del todo, para no perder conversaciones
    // nuevas de vista mientras un agente se queda scrolleado más abajo.
    refetchInterval: (query) => ((query.state.data?.pages.length ?? 1) > 1 ? 30000 : 8000),
  })

  const conversations = React.useMemo(() => data?.pages.flat(), [data])

  const { data: stats } = useQuery({
    queryKey: queryKeys.stats(accountId!),
    queryFn: () => getStats(accountId!),
    enabled: !!accountId,
    refetchInterval: 8000,
  })

  const { data: teams } = useQuery({
    queryKey: queryKeys.teams(accountId!),
    queryFn: () => getTeams(accountId!),
    enabled: !!accountId,
  })

  const counts: Record<Filter, number | undefined> = {
    all: stats && stats.bot + stats.pending + stats.open + stats.resolved,
    bot: stats?.bot,
    pending: stats?.pending,
    open: stats?.open,
    resolved: stats?.resolved,
  }

  /* El filtrado ahora lo hace el backend (?q=, busca en TODAS las
     conversaciones, no solo en las páginas ya cargadas). */
  const visible = conversations ?? []

  /* Atajos: "/" busca, j/k recorren la lista sin sacar las manos del teclado. */
  React.useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null
      const typing =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.isContentEditable

      if (e.key === '/' && !typing) {
        e.preventDefault()
        searchRef.current?.focus()
        return
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key !== 'j' && e.key !== 'k') return
      if (visible.length === 0) return

      e.preventDefault()
      const index = visible.findIndex((c) => c.id === conversationId)
      const next =
        e.key === 'j'
          ? Math.min(index + 1, visible.length - 1)
          : Math.max(index - 1, 0)
      const target2 = visible[index === -1 ? 0 : next]
      if (target2) navigate(`/accounts/${accountId}/conversations/${target2.id}`)
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [visible, conversationId, accountId, navigate])

  if (!accountId) return null

  const activeFilter = FILTERS.find((f) => f.value === filter) ?? FILTERS[0]

  return (
    <div className="flex min-h-0 flex-1">
      <section
        className={cn(
          'flex w-full shrink-0 flex-col border-r border-border bg-surface lg:w-[336px]',
          // En mobile la lista y el hilo ocupan la pantalla entera por
          // turnos -- con un hilo abierto, la lista se oculta del todo.
          conversationId && 'hidden lg:flex',
        )}
        aria-label="Lista de conversaciones"
      >
        {/* Encabezado */}
        <div className="flex h-14 items-center gap-2 px-4">
          <MobileMenuButton />
          <h1 className="text-[15px] font-semibold tracking-tight">Conversaciones</h1>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                className="ml-auto"
                onClick={() => refetch()}
                aria-label="Actualizar lista"
              >
                <RefreshCw className={cn(isFetching && 'animate-spin')} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Actualizar</TooltipContent>
          </Tooltip>
        </div>

        {/* Búsqueda */}
        <div className="px-3 pb-2">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
              placeholder="Buscar por nombre o teléfono"
              aria-label="Buscar conversaciones"
              className="h-8 w-full rounded-md border border-border bg-background pr-8 pl-8 text-[13px] outline-none placeholder:text-muted-foreground/70 focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/20 [&::-webkit-search-cancel-button]:hidden"
            />
            {query ? (
              <button
                onClick={() => setQuery('')}
                aria-label="Limpiar búsqueda"
                className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            ) : (
              <kbd className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 rounded border border-border px-1 text-[10px] text-muted-foreground">
                /
              </kbd>
            )}
          </div>
        </div>

        {/* Filtro por estado: desplegable en vez de fila de chips -- no
            pesa cuando la lista es angosta y de todos modos solo se mira uno
            a la vez. */}
        <div className="px-3 pb-2.5">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border border-transparent py-1 pr-2 pl-2.5 text-[11.5px] font-medium transition-colors duration-150',
                  activeFilter.value === 'all'
                    ? 'bg-primary-soft text-primary-soft-foreground'
                    : statusChipClass(activeFilter.value),
                )}
              >
                {activeFilter.value !== 'all' && <StatusDot status={activeFilter.value} />}
                {activeFilter.label}
                {counts[activeFilter.value] !== undefined && (
                  <span className="tabular min-w-4 rounded-full bg-black/[0.07] px-1 py-px text-center text-[10.5px] leading-[15px] font-semibold text-current dark:bg-white/15">
                    {counts[activeFilter.value]}
                  </span>
                )}
                <ChevronDown className="size-3.5 opacity-70" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-40">
              {FILTERS.map((f) => {
                const active = filter === f.value
                return (
                  <DropdownMenuItem key={f.value} onSelect={() => setFilter(f.value)} className="justify-between">
                    <span className="flex items-center gap-1.5">
                      {f.value !== 'all' && <StatusDot status={f.value} />}
                      {f.label}
                    </span>
                    <span className="flex items-center gap-1.5">
                      {counts[f.value] !== undefined && (
                        <span className="tabular min-w-4 rounded-full bg-surface-2 px-1 py-px text-center text-[10.5px] leading-[15px] font-semibold text-muted-foreground/80">
                          {counts[f.value]}
                        </span>
                      )}
                      {active && <Check className="size-3.5 text-primary" />}
                    </span>
                  </DropdownMenuItem>
                )
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Filtro por equipo */}
        {teams && teams.length > 0 && (
          <div className="flex items-center gap-2 px-3 pb-2.5">
            <label htmlFor="team-filter" className="text-[11.5px] font-medium text-muted-foreground">
              Equipo
            </label>
            <Select
              id="team-filter"
              className="h-7 w-auto text-[11.5px]"
              value={teamId}
              onChange={(e) => setTeamId(e.target.value)}
            >
              <option value="">Todos</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </div>
        )}

        {/* Lista */}
        <div className="min-h-0 flex-1 overflow-y-auto border-t border-border">
          {isLoading && <ListSkeleton />}

          {!isLoading && visible.length === 0 && (
            <EmptyState
              icon={Inbox}
              title={query ? 'Nada coincide con la búsqueda' : 'No hay conversaciones acá'}
              description={
                query
                  ? 'Probá con otro nombre o con el número completo.'
                  : filter === 'all'
                    ? 'Cuando alguien le escriba a tu número de WhatsApp, la conversación aparece en esta lista.'
                    : 'Cambiá de filtro para ver las demás.'
              }
              className="py-10"
              action={
                query ? (
                  <Button variant="outline" size="sm" onClick={() => setQuery('')}>
                    Limpiar búsqueda
                  </Button>
                ) : filter !== 'all' ? (
                  <Button variant="outline" size="sm" onClick={() => setFilter('all')}>
                    Ver todas
                  </Button>
                ) : undefined
              }
            />
          )}

          {visible.map((c) => (
            <ConversationListItem
              key={c.id}
              conversation={c}
              accountId={accountId}
              assignedToMe={!!user && c.assignee_id === user.id}
            />
          ))}

          {visible.length > 0 && (
            <div className="flex flex-col items-center gap-2 px-4 py-3">
              {hasNextPage && (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  disabled={isFetchingNextPage}
                  onClick={() => fetchNextPage()}
                >
                  {isFetchingNextPage ? <Loader2 className="animate-spin" /> : <ChevronDown />}
                  {isFetchingNextPage ? 'Cargando…' : 'Cargar más'}
                </Button>
              )}
              <p className="text-center text-[11px] text-muted-foreground">
                {visible.length} {visible.length === 1 ? 'conversación' : 'conversaciones'}
                {hasNextPage && ' cargadas'} ·{' '}
                <kbd className="rounded border border-border px-1">j</kbd>{' '}
                <kbd className="rounded border border-border px-1">k</kbd> para moverte
              </p>
              {(data?.pages.length ?? 1) > 1 && (
                <p className="text-center text-[11px] text-muted-foreground/70">
                  El refresco automático es más espaciado mientras haya más de una página cargada.
                </p>
              )}
            </div>
          )}
        </div>
      </section>

      {/* En mobile, el hilo (o el estado "elegí una conversación") solo se
          muestra una vez que hay una conversación elegida -- si no, la
          lista de arriba ya ocupa toda la pantalla. */}
      <div className={cn('flex min-w-0 flex-1', !conversationId && 'hidden lg:flex')}>
        <Outlet />
      </div>
    </div>
  )
}

function ListSkeleton() {
  return (
    <div className="divide-y divide-border">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-3 py-3.5">
          <Skeleton className="size-11 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-32" />
            <Skeleton className="h-3 w-20" />
          </div>
        </div>
      ))}
    </div>
  )
}
