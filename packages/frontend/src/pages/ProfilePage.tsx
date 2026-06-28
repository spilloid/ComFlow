import { FormEvent, useEffect, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CardHeader,
  Chip,
  Container,
  Divider,
  IconButton,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import DeleteIcon from '@mui/icons-material/Delete'
import KeyIcon from '@mui/icons-material/Key'
import SaveIcon from '@mui/icons-material/Save'
import { ApiKey } from '../../../shared/src/index.js'
import { useAuth } from '../app/AuthContext'
import {
  changePassword,
  createApiKey,
  getApiKeys,
  revokeApiKey,
  updateProfile,
} from '../lib/api'

export function ProfilePage() {
  const { user, authRequired, refresh } = useAuth()
  const [displayName, setDisplayName] = useState(user?.displayName ?? '')
  const [email, setEmail] = useState(user?.email ?? '')
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [newKeyName, setNewKeyName] = useState('')
  const [oneTimeKey, setOneTimeKey] = useState<string | null>(null)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [savingProfile, setSavingProfile] = useState(false)
  const [savingPassword, setSavingPassword] = useState(false)
  const [creatingKey, setCreatingKey] = useState(false)

  const isLocalUser = user?.authProvider === 'local'

  useEffect(() => {
    setDisplayName(user?.displayName ?? '')
    setEmail(user?.email ?? '')
  }, [user])

  useEffect(() => {
    if (!authRequired || !user) return
    void loadKeys()
  }, [authRequired, user])

  async function loadKeys() {
    try {
      const result = await getApiKeys()
      setKeys(result.items)
    } catch (reason) {
      setError((reason as Error).message)
    }
  }

  async function handleProfileSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!user) return

    setSavingProfile(true)
    setError(null)
    setNotice(null)
    try {
      await updateProfile({
        displayName: displayName.trim() ? displayName.trim() : null,
        email: email.trim(),
      })
      await refresh()
      setNotice('Profile saved.')
    } catch (reason) {
      setError((reason as Error).message)
    } finally {
      setSavingProfile(false)
    }
  }

  async function handlePasswordSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setNotice(null)

    if (newPassword !== confirmPassword) {
      setError('New passwords do not match.')
      return
    }

    setSavingPassword(true)
    try {
      await changePassword({ currentPassword, newPassword })
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setNotice('Password changed.')
    } catch (reason) {
      setError((reason as Error).message)
    } finally {
      setSavingPassword(false)
    }
  }

  async function handleCreateKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setCreatingKey(true)
    setError(null)
    setNotice(null)
    try {
      const result = await createApiKey({ name: newKeyName.trim() })
      setKeys(current => [result.key, ...current])
      setOneTimeKey(result.plaintext)
      setNewKeyName('')
      setNotice('API key created.')
    } catch (reason) {
      setError((reason as Error).message)
    } finally {
      setCreatingKey(false)
    }
  }

  async function handleRevokeKey(id: string) {
    setError(null)
    setNotice(null)
    try {
      await revokeApiKey(id)
      setKeys(current => current.filter(key => key.id !== id))
      setNotice('API key revoked.')
    } catch (reason) {
      setError((reason as Error).message)
    }
  }

  if (!user) {
    return null
  }

  if (!authRequired) {
    return (
      <Container maxWidth="md" sx={{ py: 4 }}>
        <Alert severity="info">
          Profile settings are unavailable while authentication is disabled.
        </Alert>
      </Container>
    )
  }

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Stack spacing={3}>
        <Box>
          <Typography variant="h4" fontWeight={700}>
            Profile
          </Typography>
          <Typography color="text.secondary">
            Manage your account details and MCP API keys.
          </Typography>
        </Box>

        {error && <Alert severity="error">{error}</Alert>}
        {notice && <Alert severity="success">{notice}</Alert>}

        <Card>
          <CardHeader
            title="Account"
            action={<Chip label={user.authProvider} variant="outlined" />}
          />
          <CardContent>
            <Stack component="form" spacing={2} onSubmit={handleProfileSubmit}>
              <TextField
                label="Display name"
                value={displayName}
                onChange={event => setDisplayName(event.target.value)}
                fullWidth
              />
              <TextField
                label="Email"
                type="email"
                value={email}
                onChange={event => setEmail(event.target.value)}
                disabled={!isLocalUser}
                helperText={
                  isLocalUser
                    ? 'Used for local sign-in.'
                    : 'Email is managed by your SSO provider.'
                }
                fullWidth
              />
              <Button
                type="submit"
                variant="contained"
                startIcon={<SaveIcon />}
                disabled={savingProfile || !email.trim()}
                sx={{ alignSelf: 'flex-start' }}
              >
                {savingProfile ? 'Saving...' : 'Save profile'}
              </Button>
            </Stack>
          </CardContent>
        </Card>

        <Card>
          <CardHeader title="Password" />
          <CardContent>
            {isLocalUser ? (
              <Stack component="form" spacing={2} onSubmit={handlePasswordSubmit}>
                <TextField
                  label="Current password"
                  type="password"
                  value={currentPassword}
                  onChange={event => setCurrentPassword(event.target.value)}
                  autoComplete="current-password"
                  fullWidth
                />
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                  <TextField
                    label="New password"
                    type="password"
                    value={newPassword}
                    onChange={event => setNewPassword(event.target.value)}
                    autoComplete="new-password"
                    fullWidth
                  />
                  <TextField
                    label="Confirm password"
                    type="password"
                    value={confirmPassword}
                    onChange={event => setConfirmPassword(event.target.value)}
                    autoComplete="new-password"
                    fullWidth
                  />
                </Stack>
                <Button
                  type="submit"
                  variant="outlined"
                  disabled={
                    savingPassword ||
                    !currentPassword ||
                    newPassword.length < 8 ||
                    !confirmPassword
                  }
                  sx={{ alignSelf: 'flex-start' }}
                >
                  {savingPassword ? 'Changing...' : 'Change password'}
                </Button>
              </Stack>
            ) : (
              <Typography color="text.secondary">
                Password changes are managed by your SSO provider.
              </Typography>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader title="API keys" subheader="Use these for MCP access." />
          <CardContent>
            <Stack spacing={2}>
              {oneTimeKey && (
                <Alert
                  severity="warning"
                  action={
                    <IconButton
                      aria-label="Copy API key"
                      color="inherit"
                      size="small"
                      onClick={() => void navigator.clipboard.writeText(oneTimeKey)}
                    >
                      <ContentCopyIcon fontSize="small" />
                    </IconButton>
                  }
                >
                  <Typography variant="body2" fontFamily="monospace" sx={{ wordBreak: 'break-all' }}>
                    {oneTimeKey}
                  </Typography>
                </Alert>
              )}

              {keys.length === 0 ? (
                <Typography color="text.secondary">No API keys yet.</Typography>
              ) : (
                keys.map(key => (
                  <Stack
                    key={key.id}
                    direction="row"
                    spacing={1.5}
                    alignItems="center"
                  >
                    <KeyIcon color="action" />
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography>{key.name}</Typography>
                      <Typography variant="body2" color="text.secondary">
                        {key.prefix}... · Created{' '}
                        {new Date(key.createdAt).toLocaleString()}
                        {key.lastUsedAt
                          ? ` · Last used ${new Date(key.lastUsedAt).toLocaleString()}`
                          : ''}
                      </Typography>
                    </Box>
                    <IconButton
                      aria-label="Revoke API key"
                      onClick={() => void handleRevokeKey(key.id)}
                    >
                      <DeleteIcon />
                    </IconButton>
                  </Stack>
                ))
              )}

              <Divider />

              <Stack
                component="form"
                direction={{ xs: 'column', sm: 'row' }}
                spacing={2}
                onSubmit={handleCreateKey}
              >
                <TextField
                  label="Key name"
                  size="small"
                  value={newKeyName}
                  onChange={event => setNewKeyName(event.target.value)}
                  fullWidth
                />
                <Button
                  type="submit"
                  variant="contained"
                  disabled={!newKeyName.trim() || creatingKey}
                  sx={{ minWidth: 120 }}
                >
                  {creatingKey ? 'Creating...' : 'Create'}
                </Button>
              </Stack>
            </Stack>
          </CardContent>
        </Card>
      </Stack>
    </Container>
  )
}
