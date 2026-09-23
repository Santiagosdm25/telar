import { apiFetch, apiFetchBlob } from '@/lib/api'
import type {
  AccountResponse,
  AvailableToolResponse,
  BotGraph,
  BotResponse,
  BotVersionResponse,
  ConversationDetailResponse,
  ConversationResponse,
  ConversationStatusResponse,
  ConversationStatusValue,
  ContactResponse,
  DatabaseConnectionResponse,
  DatabaseEngine,
  DiscoverModelsResponse,
  IngestResponse,
  InboxResponse,
  KnowledgeBaseResponse,
  LlmProviderKind,
  LlmProviderResponse,
  MeResponse,
  MemberResponse,
  MessageResponse,
  StatsResponse,
  TestChatResponse,
  TeamMemberResponse,
  TeamResponse,
  TemplateComponent,
  TemplateResponse,
  ToolAdminResponse,
  ToolKind,
  ToolResponse,
  TokenResponse,
  TestConnectionResponse,
  SetupStatusResponse,
} from '@/types/api'

/** El backend pagina con limit/offset y su default es 50. */
export const PAGE_SIZE = 50

export function login(email: string, password: string) {
  return apiFetch<TokenResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
}

export function getMe() {
  return apiFetch<MeResponse>('/auth/me')
}

// Cuentas, miembros y equipos

export function getAccounts() {
  return apiFetch<AccountResponse[]>('/accounts')
}

export function getSetup(accountId: string) {
  return apiFetch<SetupStatusResponse>(`/accounts/${accountId}/setup`)
}

export function createAccount(name: string) {
  return apiFetch<AccountResponse>('/accounts', {
    method: 'POST',
    body: JSON.stringify({ name }),
  })
}

export function getMembers(accountId: string) {
  return apiFetch<MemberResponse[]>(`/accounts/${accountId}/members`)
}

export function addMember(accountId: string, email: string, role: string, name?: string) {
  return apiFetch<MemberResponse>(`/accounts/${accountId}/members`, {
    method: 'POST',
    body: JSON.stringify(name?.trim() ? { email, role, name: name.trim() } : { email, role }),
  })
}

export function removeMember(accountId: string, userId: string) {
  return apiFetch<void>(`/accounts/${accountId}/members/${userId}`, { method: 'DELETE' })
}

export function getTeams(accountId: string) {
  return apiFetch<TeamResponse[]>(`/accounts/${accountId}/teams`)
}

export function createTeam(accountId: string, name: string) {
  return apiFetch<TeamResponse>(`/accounts/${accountId}/teams`, {
    method: 'POST',
    body: JSON.stringify({ name }),
  })
}

export function getTeamMembers(accountId: string, teamId: string) {
  return apiFetch<TeamMemberResponse[]>(`/accounts/${accountId}/teams/${teamId}/members`)
}

export function addTeamMember(accountId: string, teamId: string, userId: string) {
  return apiFetch<void>(`/accounts/${accountId}/teams/${teamId}/members`, {
    method: 'POST',
    body: JSON.stringify({ user_id: userId }),
  })
}

export function removeTeamMember(accountId: string, teamId: string, userId: string) {
  return apiFetch<void>(`/accounts/${accountId}/teams/${teamId}/members/${userId}`, {
    method: 'DELETE',
  })
}

// Conversaciones

export function getConversations(
  accountId: string,
  status?: ConversationStatusValue,
  {
    limit = PAGE_SIZE,
    offset = 0,
    q,
    teamId,
  }: { limit?: number; offset?: number; q?: string; teamId?: string } = {},
) {
  const qs = new URLSearchParams({ limit: String(limit), offset: String(offset) })
  if (status) qs.set('status_filter', status)
  if (q) qs.set('q', q)
  if (teamId) qs.set('team_id', teamId)
  return apiFetch<ConversationResponse[]>(`/accounts/${accountId}/conversations?${qs}`)
}

export function getConversationDetail(
  accountId: string,
  conversationId: string,
  { limit = PAGE_SIZE, before }: { limit?: number; before?: string } = {},
) {
  const qs = new URLSearchParams({ limit: String(limit) })
  if (before) qs.set('before', before)
  return apiFetch<ConversationDetailResponse>(
    `/accounts/${accountId}/conversations/${conversationId}?${qs}`,
  )
}

export function assignConversation(
  accountId: string,
  conversationId: string,
  assigneeId?: string,
) {
  return apiFetch<ConversationStatusResponse>(
    `/accounts/${accountId}/conversations/${conversationId}/assign`,
    { method: 'POST', body: JSON.stringify({ assignee_id: assigneeId ?? null }) },
  )
}

export function resolveConversation(accountId: string, conversationId: string) {
  return apiFetch<ConversationStatusResponse>(
    `/accounts/${accountId}/conversations/${conversationId}/resolve`,
    { method: 'POST' },
  )
}

export function releaseConversation(accountId: string, conversationId: string) {
  return apiFetch<ConversationStatusResponse>(
    `/accounts/${accountId}/conversations/${conversationId}/release`,
    { method: 'POST' },
  )
}

export function sendMessage(accountId: string, conversationId: string, text: string) {
  return apiFetch<MessageResponse>(
    `/accounts/${accountId}/conversations/${conversationId}/messages`,
    { method: 'POST', body: JSON.stringify({ text }) },
  )
}

export function fetchMessageMedia(accountId: string, conversationId: string, messageId: string) {
  return apiFetchBlob(
    `/accounts/${accountId}/conversations/${conversationId}/messages/${messageId}/media`,
  )
}

export function getContacts(
  accountId: string,
  { limit = PAGE_SIZE, offset = 0, q }: { limit?: number; offset?: number; q?: string } = {},
) {
  const qs = new URLSearchParams({ limit: String(limit), offset: String(offset) })
  if (q) qs.set('q', q)
  return apiFetch<ContactResponse[]>(`/accounts/${accountId}/contacts?${qs}`)
}

export function getStats(accountId: string) {
  return apiFetch<StatsResponse>(`/accounts/${accountId}/stats`)
}

export function getTemplates(accountId: string) {
  return apiFetch<TemplateResponse[]>(`/accounts/${accountId}/templates`)
}

export function sendTemplateMessage(
  accountId: string,
  conversationId: string,
  templateId: string,
  params: Record<string, string> = {},
) {
  return apiFetch<MessageResponse>(
    `/accounts/${accountId}/conversations/${conversationId}/messages/template`,
    { method: 'POST', body: JSON.stringify({ template_id: templateId, params }) },
  )
}

export function createTemplate(
  accountId: string,
  body: { name: string; language: string; components: TemplateComponent[] },
) {
  return apiFetch<TemplateResponse>(`/accounts/${accountId}/templates`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function deleteTemplate(accountId: string, templateId: string) {
  return apiFetch<void>(`/accounts/${accountId}/templates/${templateId}`, { method: 'DELETE' })
}

// Bot

export function getBot(accountId: string) {
  return apiFetch<BotResponse | null>(`/accounts/${accountId}/bot`)
}

export function saveBot(accountId: string, name: string, graph: BotGraph, notes?: string) {
  return apiFetch<BotResponse>(`/accounts/${accountId}/bot`, {
    method: 'PUT',
    body: JSON.stringify({ name, graph, notes: notes?.trim() || undefined }),
  })
}

export function getBotVersions(accountId: string) {
  return apiFetch<BotVersionResponse[]>(`/accounts/${accountId}/bot/versions`)
}

export function activateBotVersion(accountId: string, versionId: string) {
  return apiFetch<BotVersionResponse>(
    `/accounts/${accountId}/bot/versions/${versionId}/activate`,
    { method: 'POST' },
  )
}

export function getAvailableTools(accountId: string) {
  return apiFetch<AvailableToolResponse[]>(`/accounts/${accountId}/bot/available-tools`)
}

export function testChat(accountId: string, body: { message: string; session_id?: string }) {
  return apiFetch<TestChatResponse>(`/accounts/${accountId}/bot/test-chat`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

// Inboxes (números de WhatsApp)

export function getInboxes(accountId: string) {
  return apiFetch<InboxResponse[]>(`/accounts/${accountId}/inboxes`)
}

export function createInbox(
  accountId: string,
  body: {
    name: string
    phone_number_id: string
    waba_id?: string
    access_token: string
    default_team_id?: string
  },
) {
  return apiFetch<InboxResponse>(`/accounts/${accountId}/inboxes`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function updateInbox(
  accountId: string,
  inboxId: string,
  body: { name: string; default_team_id: string | null },
) {
  return apiFetch<InboxResponse>(`/accounts/${accountId}/inboxes/${inboxId}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  })
}

export function rotateInboxCredentials(
  accountId: string,
  inboxId: string,
  body: { phone_number_id: string; waba_id?: string; access_token: string },
) {
  return apiFetch<InboxResponse>(`/accounts/${accountId}/inboxes/${inboxId}/rotate-credentials`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

// Tools configurables (http/sql)

export function getTools(accountId: string) {
  return apiFetch<ToolAdminResponse[]>(`/accounts/${accountId}/tools`)
}

export function createTool(
  accountId: string,
  body: {
    name: string
    description: string
    kind: ToolKind
    config: Record<string, unknown>
    schema?: Record<string, unknown>
    secret?: Record<string, unknown> | null
  },
) {
  return apiFetch<ToolResponse>(`/accounts/${accountId}/tools`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function updateTool(
  accountId: string,
  toolId: string,
  body: {
    name: string
    description: string
    config: Record<string, unknown>
    schema?: Record<string, unknown>
    enabled: boolean
    secret?: Record<string, unknown> | null
  },
) {
  return apiFetch<ToolAdminResponse>(`/accounts/${accountId}/tools/${toolId}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

export function deleteTool(accountId: string, toolId: string) {
  return apiFetch<void>(`/accounts/${accountId}/tools/${toolId}`, { method: 'DELETE' })
}

// Proveedores LLM

export function getLlmProviders(accountId: string) {
  return apiFetch<LlmProviderResponse[]>(`/accounts/${accountId}/llm-providers`)
}

export function createLlmProvider(
  accountId: string,
  body: {
    name: string
    provider: LlmProviderKind
    model: string
    base_url?: string
    api_key?: string
  },
) {
  return apiFetch<LlmProviderResponse>(`/accounts/${accountId}/llm-providers`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function updateLlmProvider(
  accountId: string,
  providerId: string,
  body: { name: string; model: string; base_url?: string; api_key?: string },
) {
  return apiFetch<LlmProviderResponse>(`/accounts/${accountId}/llm-providers/${providerId}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

export function deleteLlmProvider(accountId: string, providerId: string) {
  return apiFetch<void>(`/accounts/${accountId}/llm-providers/${providerId}`, {
    method: 'DELETE',
  })
}

export function activateLlmProvider(accountId: string, providerId: string) {
  return apiFetch<LlmProviderResponse>(
    `/accounts/${accountId}/llm-providers/${providerId}/activate`,
    { method: 'POST' },
  )
}

export function discoverModels(
  accountId: string,
  body: { provider: LlmProviderKind; base_url?: string; api_key?: string },
) {
  return apiFetch<DiscoverModelsResponse>(`/accounts/${accountId}/llm-providers/discover-models`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

// Bases de conocimiento

export function getKnowledgeBases(accountId: string) {
  return apiFetch<KnowledgeBaseResponse[]>(`/accounts/${accountId}/knowledge-bases`)
}

export function createKnowledgeBase(accountId: string, name: string) {
  return apiFetch<KnowledgeBaseResponse>(`/accounts/${accountId}/knowledge-bases`, {
    method: 'POST',
    body: JSON.stringify({ name }),
  })
}

export function deleteKnowledgeBase(accountId: string, knowledgeBaseId: string) {
  return apiFetch<void>(`/accounts/${accountId}/knowledge-bases/${knowledgeBaseId}`, {
    method: 'DELETE',
  })
}

export function ingestDocument(accountId: string, knowledgeBaseId: string, file: File) {
  const form = new FormData()
  form.append('file', file)
  return apiFetch<IngestResponse>(
    `/accounts/${accountId}/knowledge-bases/${knowledgeBaseId}/ingest`,
    { method: 'POST', body: form },
  )
}


export function getDatabaseConnection(accountId: string) {
  return apiFetch<DatabaseConnectionResponse | null>(`/accounts/${accountId}/database`)
}

export function testDatabaseConnection(
  accountId: string,
  body: {
    engine: DatabaseEngine
    host: string
    port: number
    database_name: string
    username: string
    password: string
    use_ssl: boolean
  },
) {
  return apiFetch<TestConnectionResponse>(`/accounts/${accountId}/database/test`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function saveDatabaseConnection(
  accountId: string,
  body: {
    engine: DatabaseEngine
    host: string
    port: number
    database_name: string
    username: string
    password: string
    use_ssl: boolean
  },
) {
  return apiFetch<DatabaseConnectionResponse>(`/accounts/${accountId}/database`, {
    method: 'PUT',
    body: JSON.stringify(body),
  })
}

export function provisionDatabase(accountId: string) {
  return apiFetch<DatabaseConnectionResponse>(`/accounts/${accountId}/database/provision`, {
    method: 'POST',
  })
}

export function deleteDatabaseConnection(accountId: string) {
  return apiFetch<void>(`/accounts/${accountId}/database`, { method: 'DELETE' })
}
