import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as React from 'react'
import { toast } from 'sonner'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { ApiError } from '@/lib/api'
import { createInbox, getTeams, rotateInboxCredentials, updateInbox } from '@/lib/endpoints'
import { queryKeys } from '@/lib/queryKeys'
import type { InboxResponse } from '@/types/api'

/**
 * Formularios de conexión de WhatsApp compartidos por Configuración y el lienzo.
 * La carcasa (diálogo o panel) y los botones los pone quien los usa, vía `renderActions`.
 */

interface FormActionsArgs {
  pending: boolean
  canSubmit: boolean
}

export function TeamSelect({
  accountId,
  value,
  onChange,
  id,
}: {
  accountId: string
  value: string
  onChange: (value: string) => void
  id?: string
}) {
  const { data: teams } = useQuery({
    queryKey: queryKeys.teams(accountId),
    queryFn: () => getTeams(accountId),
  })

  return (
    <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Sin equipo por defecto</option>
      {teams?.map((t) => (
        <option key={t.id} value={t.id}>
          {t.name}
        </option>
      ))}
    </Select>
  )
}

export function CreateInboxForm({
  accountId,
  open = true,
  helperText,
  successMessage = 'WhatsApp conectado',
  onSuccess,
  renderActions,
}: {
  accountId: string
  /** Con `open`, el formulario se limpia al cerrarse; sin él nunca se limpia solo. */
  open?: boolean
  helperText?: React.ReactNode
  successMessage?: string
  onSuccess: () => void
  renderActions: (args: FormActionsArgs) => React.ReactNode
}) {
  const queryClient = useQueryClient()
  const [name, setName] = React.useState('')
  const [phoneNumberId, setPhoneNumberId] = React.useState('')
  const [wabaId, setWabaId] = React.useState('')
  const [accessToken, setAccessToken] = React.useState('')
  const [defaultTeamId, setDefaultTeamId] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)

  function reset() {
    setName('')
    setPhoneNumberId('')
    setWabaId('')
    setAccessToken('')
    setDefaultTeamId('')
    setError(null)
  }

  React.useEffect(() => {
    if (!open) reset()
  }, [open])

  const create = useMutation({
    mutationFn: () =>
      createInbox(accountId, {
        name: name.trim(),
        phone_number_id: phoneNumberId.trim(),
        waba_id: wabaId.trim() || undefined,
        access_token: accessToken.trim(),
        default_team_id: defaultTeamId || undefined,
      }),
    onSuccess: () => {
      toast.success(successMessage)
      queryClient.invalidateQueries({ queryKey: queryKeys.inboxes(accountId) })
      reset()
      onSuccess()
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'No se pudo conectar'),
  })

  const canSubmit = !!name.trim() && !!phoneNumberId.trim() && !!accessToken.trim()

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        setError(null)
        create.mutate()
      }}
    >
      {helperText}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="inbox-form-name">Nombre</Label>
        <Input
          id="inbox-form-name"
          required
          autoFocus
          placeholder="Principal"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="inbox-form-phone-id">phone_number_id</Label>
        <Input
          id="inbox-form-phone-id"
          required
          className="font-mono"
          value={phoneNumberId}
          onChange={(e) => setPhoneNumberId(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="inbox-form-waba-id">waba_id (opcional)</Label>
        <Input
          id="inbox-form-waba-id"
          className="font-mono"
          value={wabaId}
          onChange={(e) => setWabaId(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="inbox-form-token">Access token de Meta</Label>
        <Input
          id="inbox-form-token"
          required
          type="password"
          className="font-mono"
          value={accessToken}
          onChange={(e) => setAccessToken(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="inbox-form-team">Equipo por defecto</Label>
        <TeamSelect
          id="inbox-form-team"
          accountId={accountId}
          value={defaultTeamId}
          onChange={setDefaultTeamId}
        />
        <p className="text-xs text-muted-foreground">
          A qué equipo cae el traspaso a humano si nadie lo pide desde el bot.
        </p>
      </div>

      {error && (
        <p role="alert" className="rounded-md bg-destructive-soft px-3 py-2.5 text-[13px] text-destructive">
          {error}
        </p>
      )}

      {renderActions({ pending: create.isPending, canSubmit })}
    </form>
  )
}

export function EditInboxForm({
  accountId,
  inbox,
  successMessage = 'Guardado',
  onSuccess,
  renderActions,
}: {
  accountId: string
  inbox: InboxResponse
  successMessage?: string
  onSuccess?: () => void
  renderActions: (args: FormActionsArgs) => React.ReactNode
}) {
  const queryClient = useQueryClient()
  const [name, setName] = React.useState(inbox.name)
  const [defaultTeamId, setDefaultTeamId] = React.useState(inbox.default_team_id ?? '')

  React.useEffect(() => {
    setName(inbox.name)
    setDefaultTeamId(inbox.default_team_id ?? '')
  }, [inbox])

  const update = useMutation({
    mutationFn: () =>
      updateInbox(accountId, inbox.id, {
        name: name.trim(),
        default_team_id: defaultTeamId || null,
      }),
    onSuccess: () => {
      toast.success(successMessage)
      queryClient.invalidateQueries({ queryKey: queryKeys.inboxes(accountId) })
      onSuccess?.()
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'No se pudo guardar'),
  })

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        update.mutate()
      }}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="inbox-edit-name">Nombre</Label>
        <Input
          id="inbox-edit-name"
          required
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="inbox-edit-team">Equipo por defecto</Label>
        <TeamSelect
          id="inbox-edit-team"
          accountId={accountId}
          value={defaultTeamId}
          onChange={setDefaultTeamId}
        />
      </div>
      {renderActions({ pending: update.isPending, canSubmit: !!name.trim() })}
    </form>
  )
}

export function RotateCredentialsForm({
  accountId,
  inbox,
  helperText,
  onSuccess,
  renderActions,
}: {
  accountId: string
  inbox: InboxResponse
  helperText?: React.ReactNode
  onSuccess: () => void
  renderActions: (args: FormActionsArgs) => React.ReactNode
}) {
  const queryClient = useQueryClient()
  const [phoneNumberId, setPhoneNumberId] = React.useState(inbox.phone_number_id ?? '')
  const [wabaId, setWabaId] = React.useState(inbox.waba_id ?? '')
  const [accessToken, setAccessToken] = React.useState('')

  React.useEffect(() => {
    setPhoneNumberId(inbox.phone_number_id ?? '')
    setWabaId(inbox.waba_id ?? '')
    setAccessToken('')
  }, [inbox])

  const rotate = useMutation({
    mutationFn: () =>
      rotateInboxCredentials(accountId, inbox.id, {
        phone_number_id: phoneNumberId.trim(),
        waba_id: wabaId.trim() || undefined,
        access_token: accessToken.trim(),
      }),
    onSuccess: () => {
      toast.success('Credenciales actualizadas')
      queryClient.invalidateQueries({ queryKey: queryKeys.inboxes(accountId) })
      setAccessToken('')
      onSuccess()
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'No se pudo rotar credenciales'),
  })

  const canSubmit = !!phoneNumberId.trim() && !!accessToken.trim()

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        rotate.mutate()
      }}
    >
      {helperText}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="inbox-rotate-phone-id">phone_number_id</Label>
        <Input
          id="inbox-rotate-phone-id"
          required
          autoFocus
          className="font-mono"
          value={phoneNumberId}
          onChange={(e) => setPhoneNumberId(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="inbox-rotate-waba-id">waba_id (opcional)</Label>
        <Input
          id="inbox-rotate-waba-id"
          className="font-mono"
          value={wabaId}
          onChange={(e) => setWabaId(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="inbox-rotate-token">Access token nuevo</Label>
        <Input
          id="inbox-rotate-token"
          required
          type="password"
          className="font-mono"
          placeholder="El token vigente no se muestra"
          value={accessToken}
          onChange={(e) => setAccessToken(e.target.value)}
        />
      </div>
      {renderActions({ pending: rotate.isPending, canSubmit })}
    </form>
  )
}
