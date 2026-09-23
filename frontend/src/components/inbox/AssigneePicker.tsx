import { useQuery } from '@tanstack/react-query'
import { Check, ChevronDown, UserCog } from 'lucide-react'

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
import { getMembers } from '@/lib/endpoints'
import { queryKeys } from '@/lib/queryKeys'
import { ROLE_LABEL } from '@/lib/roles'

/** Administrator y supervisor pueden asignar la conversación a otra persona. */
export function AssigneePicker({
  accountId,
  assigneeId,
  disabled,
  onAssign,
}: {
  accountId: string
  assigneeId: string | null
  disabled?: boolean
  onAssign: (userId: string | undefined) => void
}) {
  const { data: members } = useQuery({
    queryKey: queryKeys.members(accountId),
    queryFn: () => getMembers(accountId),
    staleTime: 60_000,
  })

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={disabled} aria-label="Asignar">
          <UserCog />
          <span className="hidden sm:inline">Asignar</span>
          <ChevronDown className="size-3.5 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>Asignar la conversación a</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => onAssign(undefined)}>
          <Check className="opacity-0" />
          <span className="flex-1">A mí</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {members?.map((m) => (
          <DropdownMenuItem key={m.user_id} onSelect={() => onAssign(m.user_id)}>
            <ContactAvatar seed={m.user_id} name={m.name} size="sm" className="size-5 text-[9px]" />
            <span className="min-w-0 flex-1">
              <span className="block truncate">{m.name}</span>
              <span className="block truncate text-[11px] text-muted-foreground">
                {ROLE_LABEL[m.role] ?? m.role}
              </span>
            </span>
            {m.user_id === assigneeId && <Check className="size-4 text-primary" />}
          </DropdownMenuItem>
        ))}
        {members?.length === 0 && (
          <p className="px-2 py-2 text-xs text-muted-foreground">
            No hay más miembros en la cuenta.
          </p>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
