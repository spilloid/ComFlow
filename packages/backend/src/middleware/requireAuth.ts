import { NextFunction, Request, Response } from 'express'
import { User } from '../../../shared/src/index.js'
import { config } from '../config.js'
import { verifySessionToken } from '../lib/token.js'
import { userRepository } from '../repositories/userRepository.js'
import { apiKeyService } from '../services/apiKeyService.js'
import { toApiUser } from '../services/authService.js'

// Synthetic identity used when auth is not enforced (open mode), so handlers
// can always rely on res.locals.user being present.
const OPEN_MODE_ADMIN: User = {
  id: 'open-mode',
  email: 'admin@local',
  displayName: 'Open Mode',
  role: 'admin',
  authProvider: 'open',
}

/** Guard UI-facing routes. In open mode it passes through with a default admin. */
export function requireAuth(
  request: Request,
  response: Response,
  next: NextFunction
) {
  const header = request.headers.authorization
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null

  if (token?.startsWith('cf_')) {
    const resolved = apiKeyService.resolve(token)
    if (!resolved) {
      response.status(401).json({ error: 'Authentication required.' })
      return
    }
    response.locals.user = resolved.user
    next()
    return
  }

  if (!config.auth.required) {
    response.locals.user = OPEN_MODE_ADMIN
    next()
    return
  }

  const userId = token ? verifySessionToken(token) : null
  const record = userId ? userRepository.getById(userId) : null

  if (!record) {
    response.status(401).json({ error: 'Authentication required.' })
    return
  }

  response.locals.user = toApiUser(record)
  next()
}
