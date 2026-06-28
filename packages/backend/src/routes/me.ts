import { Router } from 'express'
import {
  ChangePasswordSchema,
  CreateApiKeyRequestSchema,
  UpdateProfileSchema,
  User,
} from '../../../shared/src/index.js'
import { HttpError } from '../lib/errors.js'
import { asyncHandler, parseBody } from '../lib/http.js'
import { hashPassword, verifyPassword } from '../lib/password.js'
import { userRepository } from '../repositories/userRepository.js'
import { apiKeyService } from '../services/apiKeyService.js'
import { toApiUser } from '../services/authService.js'

function requireCurrentRecord(user: User) {
  const record = userRepository.getById(user.id)
  if (!record) {
    throw new HttpError(404, 'User not found.')
  }
  return record
}

function requireParam(value: string | string[] | undefined, label: string) {
  const id = Array.isArray(value) ? value[0] : value
  if (!id) throw new HttpError(400, `${label} is required.`)
  return id
}

export function createMeRouter() {
  const router = Router()

  router.get(
    '/',
    asyncHandler((_request, response) => {
      response.json({ user: response.locals.user as User })
    })
  )

  router.patch(
    '/',
    asyncHandler((request, response) => {
      const current = response.locals.user as User
      const existing = requireCurrentRecord(current)
      const input = parseBody(UpdateProfileSchema, request.body)

      const patch: { displayName: string | null; email?: string } = {
        displayName: input.displayName,
      }

      if (existing.authProvider === 'local') {
        const duplicate = userRepository.getByEmail(input.email)
        if (duplicate && duplicate.id !== existing.id) {
          throw new HttpError(409, 'A user with that email already exists.')
        }
        patch.email = input.email
      } else if (input.email.toLowerCase() !== existing.email.toLowerCase()) {
        throw new HttpError(400, 'Email can only be changed for local users.')
      }

      const user = userRepository.updateProfile(existing.id, patch)
      response.json({ user: toApiUser(user!) })
    })
  )

  router.post(
    '/password',
    asyncHandler((request, response) => {
      const existing = requireCurrentRecord(response.locals.user as User)
      if (existing.passwordHash === null) {
        throw new HttpError(400, 'Password changes are only available for local users.')
      }

      const input = parseBody(ChangePasswordSchema, request.body)
      if (!verifyPassword(input.currentPassword, existing.passwordHash)) {
        throw new HttpError(400, 'Current password is incorrect.')
      }

      userRepository.setPassword(existing.id, hashPassword(input.newPassword))
      response.status(204).end()
    })
  )

  router.get(
    '/keys',
    asyncHandler((_request, response) => {
      const current = response.locals.user as User
      response.json({ items: apiKeyService.list(current.id) })
    })
  )

  router.post(
    '/keys',
    asyncHandler((request, response) => {
      const current = response.locals.user as User
      requireCurrentRecord(current)
      const input = parseBody(CreateApiKeyRequestSchema, request.body)
      response.status(201).json(apiKeyService.create(current.id, input.name))
    })
  )

  router.delete(
    '/keys/:id',
    asyncHandler((request, response) => {
      const current = response.locals.user as User
      const id = requireParam(request.params.id, 'API key id')
      if (!apiKeyService.revoke(current.id, id)) {
        throw new HttpError(404, 'API key not found.')
      }
      response.status(204).end()
    })
  )

  return router
}
