import { randomUUID } from 'node:crypto'
import { ApiKey, ApiKeySchema } from '../../../shared/src/index.js'
import { db } from '../db/client.js'
import { UserRecord, userRepository } from './userRepository.js'

type ApiKeyRow = {
  id: string
  user_id: string
  name: string
  prefix: string
  key_hash: string
  created_at: string
  last_used_at: string | null
}

export type ApiKeyRecord = ApiKey & {
  userId: string
  keyHash: string
}

export type ResolvedApiKey = {
  key: ApiKeyRecord
  user: UserRecord
}

function mapRow(row: ApiKeyRow): ApiKeyRecord {
  const api = ApiKeySchema.parse({
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  })
  return { ...api, userId: row.user_id, keyHash: row.key_hash }
}

export const apiKeyRepository = {
  listByUser(userId: string): ApiKeyRecord[] {
    const rows = db
      .prepare(
        'SELECT * FROM api_keys WHERE user_id = ? ORDER BY datetime(created_at) DESC'
      )
      .all(userId) as ApiKeyRow[]
    return rows.map(mapRow)
  },

  create(input: {
    userId: string
    name: string
    prefix: string
    keyHash: string
  }): ApiKeyRecord {
    const row: ApiKeyRow = {
      id: randomUUID(),
      user_id: input.userId,
      name: input.name,
      prefix: input.prefix,
      key_hash: input.keyHash,
      created_at: new Date().toISOString(),
      last_used_at: null,
    }

    db.prepare(`
      INSERT INTO api_keys (id, user_id, name, prefix, key_hash, created_at, last_used_at)
      VALUES (@id, @user_id, @name, @prefix, @key_hash, @created_at, @last_used_at)
    `).run(row)

    return mapRow(row)
  },

  resolveByHash(keyHash: string): ResolvedApiKey | null {
    const row = db
      .prepare('SELECT * FROM api_keys WHERE key_hash = ?')
      .get(keyHash) as ApiKeyRow | undefined
    if (!row) return null

    const user = userRepository.getById(row.user_id)
    return user ? { key: mapRow(row), user } : null
  },

  touch(id: string): void {
    db.prepare('UPDATE api_keys SET last_used_at = ? WHERE id = ?').run(
      new Date().toISOString(),
      id
    )
  },

  removeForUser(id: string, userId: string): boolean {
    const result = db
      .prepare('DELETE FROM api_keys WHERE id = ? AND user_id = ?')
      .run(id, userId)
    return result.changes > 0
  },
}
