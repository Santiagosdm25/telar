import * as React from 'react'
import { useParams } from 'react-router-dom'

import { MobileMenuButton } from '@/components/layout/MobileMenuButton'
import { MembersTab } from '@/components/team/MembersTab'
import { TeamsTab } from '@/components/team/TeamsTab'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useAuth } from '@/lib/auth'

export function TeamPage() {
  const { accountId } = useParams<{ accountId: string }>()
  const { user, roleForAccount } = useAuth()
  const [tab, setTab] = React.useState<'members' | 'teams'>('members')

  if (!accountId) return null
  const role = roleForAccount(accountId)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-4 border-b border-border bg-surface px-5">
        <MobileMenuButton />
        <h1 className="text-[15px] font-semibold tracking-tight">Equipo</h1>
        <Tabs value={tab} onValueChange={(v) => setTab(v as 'members' | 'teams')}>
          <TabsList>
            <TabsTrigger value="members">Miembros</TabsTrigger>
            <TabsTrigger value="teams">Equipos</TabsTrigger>
          </TabsList>
        </Tabs>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <div className="mx-auto max-w-3xl">
          {tab === 'members' ? (
            <MembersTab accountId={accountId} role={role} currentUserId={user?.id} />
          ) : (
            <TeamsTab accountId={accountId} role={role} />
          )}
        </div>
      </div>
    </div>
  )
}
