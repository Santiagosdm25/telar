import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { ChevronDown, Loader2, Search, Users, X } from 'lucide-react'
import * as React from 'react'
import { Link, useParams } from 'react-router-dom'

import { EmptyState } from '@/components/EmptyState'
import { MobileMenuButton } from '@/components/layout/MobileMenuButton'
import { ContactAvatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { getContacts, getConversations, PAGE_SIZE } from '@/lib/endpoints'
import { queryKeys } from '@/lib/queryKeys'
import { formatPhone } from '@/lib/format'
import { useDebouncedValue } from '@/lib/useDebouncedValue'

export function ContactsPage() {
  const { accountId } = useParams<{ accountId: string }>()
  const [query, setQuery] = React.useState('')
  const debouncedQuery = useDebouncedValue(query.trim(), 300)

  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: queryKeys.contacts(accountId!, debouncedQuery),
    queryFn: ({ pageParam }) =>
      getContacts(accountId!, { offset: pageParam, q: debouncedQuery || undefined }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) =>
      (lastPage?.length ?? 0) < PAGE_SIZE ? undefined : allPages.length * PAGE_SIZE,
    enabled: !!accountId,
  })

  const contacts = React.useMemo(() => data?.pages.flat(), [data])

  /* Para poder saltar del contacto a su conversación sin buscarla a mano. */
  const { data: conversations } = useQuery({
    queryKey: queryKeys.conversations.all(accountId!),
    queryFn: () => getConversations(accountId!),
    enabled: !!accountId,
  })

  const conversationByContact = React.useMemo(() => {
    const map = new Map<string, string>()
    conversations?.forEach((c) => map.set(c.contact_id, c.id))
    return map
  }, [conversations])

  /* El filtrado ahora lo hace el backend (?q=: nombre, teléfono o email, en
     TODOS los contactos, no solo en las páginas ya cargadas). El wa_id no lo
     busca la API todavía, así que ese campo queda fuera de la búsqueda. */
  const visible = contacts ?? []

  if (!accountId) return null

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-surface px-5">
        <MobileMenuButton />
        <h1 className="text-[15px] font-semibold tracking-tight">Contactos</h1>
        {contacts && (
          <span className="tabular rounded-full bg-surface-2 px-2 py-0.5 text-xs text-muted-foreground">
            {contacts.length}
            {hasNextPage && '+'}
          </span>
        )}
        <div className="relative ml-auto w-64">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por nombre, teléfono o email"
            aria-label="Buscar contactos"
            className="h-8 w-full rounded-md border border-border bg-background pr-8 pl-8 text-[13px] outline-none placeholder:text-muted-foreground/70 focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/20 [&::-webkit-search-cancel-button]:hidden"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              aria-label="Limpiar búsqueda"
              className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        {isLoading && (
          <div className="space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-12 rounded-lg" />
            ))}
          </div>
        )}

        {!isLoading && visible.length === 0 && (
          <EmptyState
            icon={Users}
            title={query ? 'Ningún contacto coincide' : 'Todavía no hay contactos'}
            description={
              query
                ? 'Probá con otro nombre, teléfono o email.'
                : 'Cada persona que le escriba a tu número aparece acá automáticamente.'
            }
            action={
              query ? (
                <Button variant="outline" size="sm" onClick={() => setQuery('')}>
                  Limpiar búsqueda
                </Button>
              ) : undefined
            }
          />
        )}

        {!isLoading && visible.length > 0 && (
          <div className="overflow-hidden rounded-xl border border-border bg-surface">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="pl-4">Contacto</TableHead>
                  <TableHead>Teléfono</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>wa_id</TableHead>
                  <TableHead className="w-px pr-4" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((c) => {
                  const conversationId = conversationByContact.get(c.id)
                  return (
                    <TableRow key={c.id}>
                      <TableCell className="pl-4">
                        <div className="flex items-center gap-2.5">
                          <ContactAvatar seed={c.id} name={c.name} size="sm" />
                          <span className="font-medium">{c.name ?? 'Sin nombre'}</span>
                        </div>
                      </TableCell>
                      <TableCell className="tabular font-mono text-[12.5px] text-muted-foreground">
                        {formatPhone(c.phone)}
                      </TableCell>
                      <TableCell className="text-[12.5px] text-muted-foreground">
                        {c.email ?? '—'}
                      </TableCell>
                      <TableCell className="font-mono text-[12.5px] text-muted-foreground">
                        {c.external_id}
                      </TableCell>
                      <TableCell className="pr-4 text-right">
                        {conversationId && (
                          <Button variant="ghost" size="xs" asChild>
                            <Link to={`/accounts/${accountId}/conversations/${conversationId}`}>
                              Ver conversación
                            </Link>
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}

        {hasNextPage && !isLoading && (
          <div className="mt-3 flex justify-center">
            <Button
              variant="outline"
              size="sm"
              disabled={isFetchingNextPage}
              onClick={() => fetchNextPage()}
            >
              {isFetchingNextPage ? <Loader2 className="animate-spin" /> : <ChevronDown />}
              {isFetchingNextPage ? 'Cargando…' : 'Cargar más contactos'}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
