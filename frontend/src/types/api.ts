// Calco directo de los modelos Pydantic de backend/telar/{auth,accounts,conversations}/router.py

export interface AccountMembership {
  account_id: string
  role: string
}

export interface MeResponse {
  id: string
  email: string
  name: string
  is_superadmin: boolean
  accounts: AccountMembership[]
}

export interface TokenResponse {
  access_token: string
  token_type: string
}

export interface AccountResponse {
  id: string
  name: string
}

export type AccountRoleValue = 'administrator' | 'supervisor' | 'agent'

export interface MemberResponse {
  user_id: string
  email: string
  name: string
  role: string
  /** Presente solo la vez que se crea el usuario de una: hay que mostrarla y no vuelve a llegar. */
  temporary_password?: string | null
}

export interface TeamResponse {
  id: string
  name: string
}

export interface TeamMemberResponse {
  user_id: string
  email: string
  name: string
}

export type ConversationStatusValue = 'bot' | 'pending' | 'open' | 'resolved'

export interface ConversationResponse {
  id: string
  status: ConversationStatusValue
  assignee_id: string | null
  team_id: string | null
  contact_id: string
  contact_name: string | null
  contact_phone: string | null
  last_contact_message_at: string | null
}

export interface ConversationStatusResponse {
  id: string
  status: ConversationStatusValue
  assignee_id: string | null
}

export interface MessageMedia {
  external_id: string | null
  mime_type: string | null
  filename: string | null
  sha256: string | null
  size_bytes: number | null
  storage_url: string | null
  caption: string | null
}

export interface MessageResponse {
  id: string
  sender_type: 'contact' | 'bot' | 'agent' | 'system'
  sender_id: string | null
  type: string
  content: string | null
  /** Solo en mensajes de imagen/audio/video/documento. */
  media: MessageMedia | null
  /** 'pending' | 'sent' | 'delivered' | 'read' | 'failed'; suelto porque el backend puede sumar valores. */
  delivery_status: string
  created_at: string
}

export interface ConversationDetailResponse {
  id: string
  status: ConversationStatusValue
  assignee_id: string | null
  contact_id: string
  contact_name: string | null
  contact_phone: string | null
  last_contact_message_at: string | null
  messages: MessageResponse[]
}

export interface ContactResponse {
  id: string
  external_id: string
  name: string | null
  phone: string | null
  email: string | null
}

/** Formato v1 (cadena lineal). Solo se lee, para convertir bots viejos a v2. */
export interface LegacyGraphNode {
  id: string
  type: 'agent'
  system_prompt?: string | null
  tools?: string[] | null
  memory_window?: number | null
}

export interface LegacyBotGraph {
  version?: undefined
  nodes: LegacyGraphNode[]
  edges: { from: string; to: string }[]
}

/** Formato v2: agente principal + sub-agentes. Ver backend/telar/agent/multi_agent.py. */
export interface GraphAgent {
  id: string
  role: 'main' | 'sub'
  name: string
  /** Sub-agentes: cuándo lo llama el principal. Obligatoria para role=sub. */
  description?: string | null
  system_prompt?: string | null
  tools: string[]
  subagents?: string[]
  /** Cuántos mensajes recientes ve el principal. null = sin límite. */
  memory_window?: number | null
}

export interface BotGraphV2 {
  version: 2
  agents: GraphAgent[]
  /** Posiciones en el lienzo: id del agente, "START" o "tool:<nombre>". */
  layout: Record<string, { x: number; y: number }>
}

export type BotGraph = BotGraphV2 | LegacyBotGraph

export interface BotResponse {
  id: string
  name: string
  version: number
  graph: BotGraph
}

export interface AvailableToolResponse {
  name: string
  description: string
  /** "system" (las fijas de Telar), "http", "sql" o "document". */
  kind: string
}

export interface TemplateComponent {
  type: string
  format?: string
  text?: string
  buttons?: unknown[]
}

export interface TemplateResponse {
  id: string
  name: string
  language: string
  components: TemplateComponent[]
}

export interface BotVersionResponse {
  id: string
  version: number
  notes: string | null
  created_by: string | null
  created_at: string
  is_active: boolean
}

export interface InboxResponse {
  id: string
  name: string
  channel: string
  phone_number_id: string | null
  waba_id: string | null
  default_team_id: string | null
  created_at: string
}

export type ToolKind = 'http' | 'sql' | 'document'

export interface ToolResponse {
  id: string
  name: string
  description: string
  kind: ToolKind
  config: Record<string, unknown>
  schema: Record<string, unknown>
}

export interface ToolAdminResponse extends ToolResponse {
  enabled: boolean
}

export type LlmProviderKind = 'openai' | 'anthropic' | 'openrouter' | 'ollama'

export interface LlmProviderResponse {
  id: string
  name: string
  provider: LlmProviderKind
  model: string
  base_url: string | null
  is_active: boolean
}

export interface DiscoverModelsResponse {
  models: string[]
}

export type DatabaseEngine = 'postgres' | 'mysql'
export type DatabaseConnectionStatus = 'disconnected' | 'connected' | 'provisioned' | 'error'

export interface DatabaseConnectionResponse {
  engine: DatabaseEngine
  host: string
  port: number
  database_name: string
  username: string
  use_ssl: boolean
  status: DatabaseConnectionStatus
  last_error: string | null
  provisioned_at: string | null
  updated_at: string
}

export interface TestConnectionResponse {
  ok: boolean
  error: string | null
}

export interface TraceEvent {
  /** id del agente que actuó. */
  agent: string
  kind: 'delegated' | 'tool_call' | 'tool_result' | 'message' | 'error'
  name?: string | null
  args?: Record<string, unknown> | null
  text?: string | null
  error?: boolean
}

export interface TestChatResponse {
  session_id: string
  reply: string
  would_escalate: boolean
  trace: TraceEvent[]
}

export interface KnowledgeBaseResponse {
  id: string
  name: string
  embedding_model: string
  dimensions: number
}

export interface IngestResponse {
  chunks_inserted: number
}

export interface StatsResponse {
  bot: number
  pending: number
  open: number
  resolved: number
}

export type SetupNextStep = 'inbox' | 'llm' | 'prompt' | 'done'

export interface SetupStatusResponse {
  ready: boolean
  complete: boolean
  next_step: SetupNextStep
  has_inbox: boolean
  has_inbox_credentials: boolean
  uses_env_credentials: boolean
  has_active_llm: boolean
  uses_default_llm: boolean
  has_custom_prompt: boolean
  inbox_name: string | null
  webhook_path: string
}
