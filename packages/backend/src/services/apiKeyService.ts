import crypto from 'node:crypto'
import { ApiKey } from '../../../shared/src/index.js'
import { apiKeyRepository } from '../repositories/apiKeyRepository.js'
import { UserRecord } from '../repositories/userRepository.js'
import { toApiUser } from './authService.js'

const KEY_PREFIX = 'cf_'
const DISPLAY_PREFIX_LENGTH = 12

function hashApiKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex')
}

function generatePlaintextKey(): string {
  return `${KEY_PREFIX}${crypto.randomBytes(32).toString('base64url')}`
}

export const apiKeyService = {
  list(userId: string): ApiKey[] {
    return apiKeyRepository.listByUser(userId).map(
      ({ userId: _userId, keyHash: _keyHash, ...api }) => {
        void _userId
        void _keyHash
        return api
      }
    )
  },

  create(userId: string, name: string): { key: ApiKey; plaintext: string } {
    const plaintext = generatePlaintextKey()
    const record = apiKeyRepository.create({
      userId,
      name,
      prefix: plaintext.slice(0, DISPLAY_PREFIX_LENGTH),
      keyHash: hashApiKey(plaintext),
    })
    const { userId: _userId, keyHash: _keyHash, ...key } = record
    void _userId
    void _keyHash
    return { key, plaintext }
  },

  resolve(plaintext: string): { user: ReturnType<typeof toApiUser> } | null {
    if (!plaintext.startsWith(KEY_PREFIX)) return null
    const resolved = apiKeyRepository.resolveByHash(hashApiKey(plaintext))
    if (!resolved) return null
    apiKeyRepository.touch(resolved.key.id)
    return { user: toApiUser(resolved.user as UserRecord) }
  },

  revoke(userId: string, id: string): boolean {
    return apiKeyRepository.removeForUser(id, userId)
  },
}
