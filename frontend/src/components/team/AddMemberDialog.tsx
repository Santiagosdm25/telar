import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { ApiError } from '@/lib/api'
import { addMember } from '@/lib/endpoints'
import { queryKeys } from '@/lib/queryKeys'
import { assignableRolesFor, ROLE_HINT, ROLE_LABEL } from '@/lib/roles'
import type { AccountRoleValue } from '@/types/api'

import { TemporaryPasswordField } from './TemporaryPasswordField'

export function AddMemberDialog({
  accountId,
  actorRole,
  open,
  onOpenChange,
}: {
  accountId: string
  actorRole: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const assignableRoles = assignableRolesFor(actorRole)
  const queryClient = useQueryClient()
  const [email, setEmail] = React.useState('')
  const [name, setName] = React.useState('')
  const [role, setRole] = React.useState<AccountRoleValue>('agent')
  const [error, setError] = React.useState<string | null>(null)
  const [created, setCreated] = React.useState<{ email: string; password: string } | null>(null)

  const add = useMutation({
    mutationFn: () => addMember(accountId, email.trim(), role, name),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.members(accountId) })
      if (data.temporary_password) {
        // La contraseña temporal no se puede volver a ver: se muestra ahora.
        setCreated({ email: data.email, password: data.temporary_password })
      } else {
        toast.success('Miembro sumado a la cuenta')
        reset()
        onOpenChange(false)
      }
    },
    onError: (e) =>
      setError(e instanceof ApiError ? e.message : 'No se pudo sumar a esta persona'),
  })

  function reset() {
    setEmail('')
    setName('')
    setError(null)
    setCreated(null)
  }

  function close() {
    reset()
    onOpenChange(false)
  }

  if (created) {
    return (
      <Dialog open={open} onOpenChange={close}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Usuario creado</DialogTitle>
            <DialogDescription>
              {created.email} todavía no tenía cuenta, así que se creó con esta contraseña
              temporal. Compartila por un canal seguro -- no se vuelve a mostrar.
            </DialogDescription>
          </DialogHeader>
          <TemporaryPasswordField password={created.password} />
          <DialogFooter>
            <Button size="sm" onClick={close}>
              Listo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Sumar miembro</DialogTitle>
          <DialogDescription>
            Si la persona ya tiene cuenta en Telar, alcanza con el correo. Si no, completá el
            nombre y se le crea una cuenta nueva.
          </DialogDescription>
        </DialogHeader>

        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            setError(null)
            add.mutate()
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="member-email">Correo</Label>
            <Input
              id="member-email"
              type="email"
              required
              autoFocus
              placeholder="asesor@tuempresa.com"
              value={email}
              aria-invalid={!!error}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="member-name">Nombre completo</Label>
            <Input
              id="member-name"
              placeholder="Nombre Apellido"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Solo hace falta si la persona todavía no tiene cuenta en Telar.
            </p>
          </div>

          {assignableRoles.length > 1 && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="member-role">Rol</Label>
              <Select
                id="member-role"
                value={role}
                onChange={(e) => setRole(e.target.value as AccountRoleValue)}
              >
                {assignableRoles.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </option>
                ))}
              </Select>
              <p className="text-xs text-muted-foreground">{ROLE_HINT[role]}</p>
            </div>
          )}
          {assignableRoles.length <= 1 && (
            <p className="text-xs text-muted-foreground">
              Como supervisor, sumás gente como <strong>{ROLE_LABEL.agent}</strong>. Para otros
              roles pedile a un administrador.
            </p>
          )}

          {error && (
            <div
              role="alert"
              className="rounded-md bg-destructive-soft px-3 py-2.5 text-[13px] text-destructive"
            >
              <p>{error}</p>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" size="sm" onClick={close}>
              Cancelar
            </Button>
            <Button type="submit" size="sm" disabled={add.isPending || !email.trim()}>
              {add.isPending && <Loader2 className="animate-spin" />}
              Sumar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
