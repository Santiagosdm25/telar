import { Navigate, Route, Routes } from 'react-router-dom'

import { AccountLayout } from '@/routes/AccountLayout'
import { AccountPickerPage } from '@/routes/AccountPickerPage'
import { BotFlowPage } from '@/routes/BotFlowPage'
import { ContactsPage } from '@/routes/ContactsPage'
import { InboxLayout } from '@/routes/InboxLayout'
import { LoginPage } from '@/routes/LoginPage'
import { NoThreadSelected } from '@/routes/NoThreadSelected'
import { RootRedirect } from '@/routes/RootRedirect'
import { SettingsPage } from '@/routes/SettingsPage'
import { TeamPage } from '@/routes/TeamPage'
import { ThreadPage } from '@/routes/ThreadPage'

function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/" element={<RootRedirect />} />
      <Route path="/accounts" element={<AccountPickerPage />} />
      <Route path="/accounts/:accountId" element={<AccountLayout />}>
        <Route index element={<Navigate to="conversations" replace />} />
        {/* Cada conversación conserva su propia URL para poder compartirla. */}
        <Route path="conversations" element={<InboxLayout />}>
          <Route index element={<NoThreadSelected />} />
          <Route path=":conversationId" element={<ThreadPage />} />
        </Route>
        <Route path="contacts" element={<ContactsPage />} />
        <Route path="team" element={<TeamPage />} />
        <Route path="bot" element={<BotFlowPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default App
