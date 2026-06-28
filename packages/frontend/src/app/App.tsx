import { Box, CircularProgress, CssBaseline, ThemeProvider } from '@mui/material'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { theme } from './theme'
import { AuthProvider, useAuth } from './AuthContext'
import { AppShell } from '../components/AppShell'
import { AccessPage } from '../pages/AccessPage'
import { CallDetailPage } from '../pages/CallDetailPage'
import { CallInboxPage } from '../pages/CallInboxPage'
import { LoginPage } from '../pages/LoginPage'
import { ProfilePage } from '../pages/ProfilePage'
import { ScheduledCallsPage } from '../pages/ScheduledCallsPage'
import { SettingsPage } from '../pages/SettingsPage'

function AppGate() {
  const { user, authRequired, loading } = useAuth()
  // Open mode (auth not enforced) grants the synthetic admin full access, so
  // the admin UI should show there too — matching the backend's behavior.
  const isAdmin = !authRequired || user?.role === 'admin'

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', mt: 8 }}>
        <CircularProgress />
      </Box>
    )
  }

  if (authRequired && !user) {
    return <LoginPage />
  }

  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<Navigate to="/calls" replace />} />
        <Route path="/calls" element={<CallInboxPage />} />
        <Route path="/calls/:id" element={<CallDetailPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/scheduled-calls" element={<ScheduledCallsPage />} />
        {/* Connections was folded into the Settings → Mailboxes tab. */}
        <Route path="/connections" element={<Navigate to="/settings" replace />} />
        <Route
          path="/settings"
          element={
            isAdmin ? <SettingsPage /> : <Navigate to="/calls" replace />
          }
        />
        <Route
          path="/access"
          element={
            isAdmin ? <AccessPage /> : <Navigate to="/calls" replace />
          }
        />
      </Routes>
    </AppShell>
  )
}

export function App() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <AuthProvider>
        <BrowserRouter>
          <AppGate />
        </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  )
}
