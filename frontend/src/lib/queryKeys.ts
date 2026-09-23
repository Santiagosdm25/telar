/**
 * TanStack invalida por prefijo: `conversations.byAccount(id)` alcanza a `.all` y a
 * cualquier `.list` de la cuenta sin enumerarlas.
 */
export const queryKeys = {
  accounts: () => ['accounts'] as const,
  stats: (accountId: string) => ['stats', accountId] as const,

  members: (accountId: string) => ['members', accountId] as const,
  teams: (accountId: string) => ['teams', accountId] as const,
  teamMembers: (accountId: string, teamId: string | undefined) =>
    ['team-members', accountId, teamId] as const,

  inboxes: (accountId: string) => ['inboxes', accountId] as const,

  tools: (accountId: string) => ['tools', accountId] as const,
  availableTools: (accountId: string) => ['available-tools', accountId] as const,

  templates: (accountId: string) => ['templates', accountId] as const,
  knowledgeBases: (accountId: string) => ['knowledge-bases', accountId] as const,
  llmProviders: (accountId: string) => ['llm-providers', accountId] as const,
  databaseConnection: (accountId: string) => ['database-connection', accountId] as const,

  bot: (accountId: string) => ['bot', accountId] as const,
  botVersions: (accountId: string) => ['bot-versions', accountId] as const,

  conversation: (accountId: string, conversationId: string) =>
    ['conversation', accountId, conversationId] as const,
  conversations: {
    byAccount: (accountId: string) => ['conversations', accountId] as const,
    all: (accountId: string) => ['conversations', accountId, 'all'] as const,
    list: (accountId: string, filter: string, teamId: string, query: string) =>
      ['conversations', accountId, 'list', filter, teamId, query] as const,
  },

  contacts: (accountId: string, query: string) => ['contacts', accountId, query] as const,
}
