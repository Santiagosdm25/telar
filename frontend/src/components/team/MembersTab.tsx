import { useQuery } from '@tanstack/react-query'
import { Trash2, UserPlus, Users } from 'lucide-react'
import * as React from 'react'

import { EmptyState } from '@/components/EmptyState'
import { ContactAvatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
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
import { getMembers } from '@/lib/endpoints'
import { queryKeys } from '@/lib/queryKeys'
import { ASSIGNABLE_ROLES, canManageMembers, isAdmin, ROLE_HINT, ROLE_LABEL } from '@/lib/roles'
import type { MemberResponse } from '@/types/api'

import { AddMemberDialog } from './AddMemberDialog'
import { RemoveMemberDialog } from './RemoveMemberDialog'

export function MembersTab({
  accountId,
  role,
  currentUserId,
}: {
  accountId: string
  role: string | null
  currentUserId?: string
}) {
  const canManage = canManageMembers(role)
  const [adding, setAdding] = React.useState(false)
  const [removing, setRemoving] = React.useState<MemberResponse | null>(null)

  const { data: members, isLoading } = useQuery({
    queryKey: queryKeys.members(accountId),
    queryFn: () => getMembers(accountId),
  })

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-start gap-4">
        <div className="flex-1">
          <h2 className="text-sm font-semibold">Miembros de la cuenta</h2>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            Quién tiene acceso a esta bandeja y con qué permisos.
          </p>
        </div>
        {canManage && (
          <Button size="sm" onClick={() => setAdding(true)}>
            <UserPlus />
            Sumar miembro
          </Button>
        )}
      </div>

      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-12 rounded-lg" />
          ))}
        </div>
      )}

      {members && members.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-border bg-surface">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-4">Persona</TableHead>
                <TableHead>Rol</TableHead>
                {canManage && <TableHead className="w-px pr-4" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((m) => (
                <TableRow key={m.user_id}>
                  <TableCell className="pl-4">
                    <div className="flex items-center gap-2.5">
                      <ContactAvatar seed={m.user_id} name={m.name} size="sm" />
                      <div className="min-w-0">
                        <p className="truncate font-medium">
                          {m.name}
                          {m.user_id === currentUserId && (
                            <span className="ml-1.5 text-[11px] text-muted-foreground">(vos)</span>
                          )}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">{m.email}</p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={m.role === 'administrator' ? 'default' : 'secondary'}>
                      {ROLE_LABEL[m.role] ?? m.role}
                    </Badge>
                  </TableCell>
                  {canManage && (
                    <TableCell className="pr-4 text-right">
                      {/* Un supervisor solo puede sacar asesores, igual que en el backend. */}
                      {m.user_id !== currentUserId && (isAdmin(role) || m.role === 'agent') && (
                        <Button
                          variant="destructive-ghost"
                          size="xs"
                          title="Sacar de la cuenta"
                          onClick={() => setRemoving(m)}
                        >
                          <Trash2 />
                          Sacar
                        </Button>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {members?.length === 0 && (
        <EmptyState
          icon={Users}
          title="No hay miembros todavía"
          description="Sumá gente por su correo. El usuario tiene que existir antes."
        />
      )}

      <div className="rounded-xl border border-border bg-surface p-4">
        <p className="mb-2.5 text-[13px] font-medium">Qué puede hacer cada rol</p>
        <dl className="flex flex-col gap-2">
          {ASSIGNABLE_ROLES.map((r) => (
            <div key={r} className="flex gap-3 text-[13px]">
              <dt className="w-28 shrink-0 font-medium">{ROLE_LABEL[r]}</dt>
              <dd className="text-muted-foreground">{ROLE_HINT[r]}</dd>
            </div>
          ))}
        </dl>
      </div>

      <AddMemberDialog accountId={accountId} actorRole={role} open={adding} onOpenChange={setAdding} />
      <RemoveMemberDialog
        accountId={accountId}
        member={removing}
        onOpenChange={(open) => !open && setRemoving(null)}
      />
    </section>
  )
}
