import {
  AppBar,
  Box,
  Button,
  Stack,
  Toolbar,
  Typography,
} from '@mui/material'
import { NavLink } from 'react-router-dom'
import { useAuth } from '../app/AuthContext'

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, authRequired, logout } = useAuth()
  const isAdmin = !authRequired || user?.role === 'admin'

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <AppBar position="static" elevation={0} sx={{ borderBottom: 1, borderColor: 'divider' }}>
        <Toolbar>
          <Typography variant="h6" fontWeight={700} sx={{ letterSpacing: '-0.5px', flexGrow: 1 }}>
            ComFlow
          </Typography>
          <Stack direction="row" spacing={1} alignItems="center">
            <Button color="inherit" component={NavLink} to="/calls">
              Inbox
            </Button>
            <Button color="inherit" component={NavLink} to="/scheduled-calls">
              Scheduled
            </Button>
            {isAdmin && (
              <Button color="inherit" component={NavLink} to="/settings">
                Settings
              </Button>
            )}
            {isAdmin && (
              <Button color="inherit" component={NavLink} to="/access">
                Access
              </Button>
            )}
            {authRequired && user && (
              <Button color="inherit" component={NavLink} to="/profile">
                Profile
              </Button>
            )}
            {authRequired && user && (
              <Button color="inherit" onClick={logout}>
                Sign out
              </Button>
            )}
          </Stack>
        </Toolbar>
      </AppBar>
      <Box component="main" sx={{ flex: 1 }}>
        {children}
      </Box>
    </Box>
  )
}
