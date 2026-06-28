import { randomUUID } from 'node:crypto'
import { User, UserRole, UserSchema } from '../../../shared/src/index.js'
import { db } from '../db/client.js'

type UserRow = {
  id: string
  email: string
  display_name: string | null
  password_hash: string | null
  role: UserRole
  auth_provider: string
  external_id: string | null
  created_at: string
  updated_at: string
}

export type UserRecord = User & {
  passwordHash: string | null
  externalId: string | null
}

function mapRow(row: UserRow): UserRecord {
  const api = UserSchema.parse({
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    authProvider: row.auth_provider,
  })
  return { ...api, passwordHash: row.password_hash, externalId: row.external_id }
}

export const userRepository = {
  count(): number {
    const row = db.prepare('SELECT COUNT(*) as count FROM users').get() as {
      count: number
    }
    return row.count
  },

  list(): UserRecord[] {
    const rows = db
      .prepare('SELECT * FROM users ORDER BY lower(email) ASC')
      .all() as UserRow[]
    return rows.map(mapRow)
  },

  getByEmail(email: string): UserRecord | null {
    const row = db
      .prepare('SELECT * FROM users WHERE lower(email) = lower(?)')
      .get(email) as UserRow | undefined
    return row ? mapRow(row) : null
  },

  getById(id: string): UserRecord | null {
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as
      | UserRow
      | undefined
    return row ? mapRow(row) : null
  },

  create(input: {
    email: string
    displayName: string | null
    passwordHash: string | null
    role: UserRole
    authProvider?: string
    externalId?: string | null
  }): UserRecord {
    const now = new Date().toISOString()
    const row: UserRow = {
      id: randomUUID(),
      email: input.email,
      display_name: input.displayName,
      password_hash: input.passwordHash,
      role: input.role,
      auth_provider: input.authProvider ?? 'local',
      external_id: input.externalId ?? null,
      created_at: now,
      updated_at: now,
    }
    db.prepare(`
      INSERT INTO users (
        id, email, display_name, password_hash, role, auth_provider, external_id, created_at, updated_at
      )
      VALUES (@id, @email, @display_name, @password_hash, @role, @auth_provider, @external_id, @created_at, @updated_at)
    `).run(row)
    return mapRow(row)
  },

  setRole(id: string, role: UserRole): void {
    db.prepare('UPDATE users SET role = ?, updated_at = ? WHERE id = ?').run(
      role,
      new Date().toISOString(),
      id
    )
  },

  update(
    id: string,
    patch: { displayName?: string | null; role?: UserRole }
  ): UserRecord | null {
    const existing = this.getById(id)
    if (!existing) return null
    db.prepare(`
      UPDATE users SET display_name = ?, role = ?, updated_at = ? WHERE id = ?
    `).run(
      patch.displayName !== undefined ? patch.displayName : existing.displayName,
      patch.role ?? existing.role,
      new Date().toISOString(),
      id
    )
    return this.getById(id)
  },

  updateProfile(
    id: string,
    patch: { displayName: string | null; email?: string }
  ): UserRecord | null {
    const existing = this.getById(id)
    if (!existing) return null

    db.prepare(`
      UPDATE users SET display_name = ?, email = ?, updated_at = ? WHERE id = ?
    `).run(
      patch.displayName,
      patch.email ?? existing.email,
      new Date().toISOString(),
      id
    )

    return this.getById(id)
  },

  setPassword(id: string, passwordHash: string): void {
    db.prepare(
      'UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?'
    ).run(passwordHash, new Date().toISOString(), id)
  },

  remove(id: string): boolean {
    const result = db.prepare('DELETE FROM users WHERE id = ?').run(id)
    return result.changes > 0
  },

  countAdmins(): number {
    const row = db
      .prepare("SELECT COUNT(*) as count FROM users WHERE role = 'admin'")
      .get() as { count: number }
    return row.count
  },

  /**
   * Provision (or refresh) a user from an SSO identity, matched by email. New
   * users default to the `member` role; an existing user's role is left alone
   * here (admin promotion via the allowlist happens in the SSO service). Records
   * the external subject id and the originating provider for traceability.
   */
  upsertBySsoIdentity(input: {
    email: string
    displayName: string | null
    externalId: string
    authProvider: string
  }): UserRecord {
    const existing = this.getByEmail(input.email)
    if (existing) {
      db.prepare(`
        UPDATE users
        SET display_name = COALESCE(?, display_name),
            external_id = ?,
            auth_provider = ?,
            updated_at = ?
        WHERE id = ?
      `).run(
        input.displayName,
        input.externalId,
        input.authProvider,
        new Date().toISOString(),
        existing.id
      )
      return this.getById(existing.id)!
    }

    return this.create({
      email: input.email,
      displayName: input.displayName,
      passwordHash: null,
      role: 'member',
      authProvider: input.authProvider,
      externalId: input.externalId,
    })
  },
}
