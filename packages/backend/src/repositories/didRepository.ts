import { randomUUID } from 'node:crypto'
import { ProvisionedDid, ProvisionedDidSchema } from '../../../shared/src/index.js'
import { db } from '../db/client.js'

type DidRow = {
  id: string
  tenant_id: string
  number: string
  provider: string
  status: 'active' | 'released'
  monthly_cents: number
  per_minute_cents: number
  mailbox_id: string | null
  created_at: string
  released_at: string | null
}

function mapRow(row: DidRow): ProvisionedDid {
  return ProvisionedDidSchema.parse({
    id: row.id,
    number: row.number,
    provider: row.provider,
    status: row.status,
    monthlyCents: row.monthly_cents,
    perMinuteCents: row.per_minute_cents,
    mailboxId: row.mailbox_id,
    createdAt: row.created_at,
    releasedAt: row.released_at,
  })
}

export const didRepository = {
  listByTenant(tenantId: string): ProvisionedDid[] {
    const rows = db
      .prepare(
        'SELECT * FROM provisioned_dids WHERE tenant_id = ? ORDER BY datetime(created_at) DESC'
      )
      .all(tenantId) as DidRow[]
    return rows.map(mapRow)
  },

  /** Active DIDs across all tenants — for monthly rental billing sweeps. */
  listActive(): ProvisionedDid[] {
    const rows = db
      .prepare("SELECT * FROM provisioned_dids WHERE status = 'active'")
      .all() as DidRow[]
    return rows.map(mapRow)
  },

  getByNumber(number: string): ProvisionedDid | null {
    const row = db
      .prepare('SELECT * FROM provisioned_dids WHERE number = ?')
      .get(number) as DidRow | undefined
    return row ? mapRow(row) : null
  },

  tenantIdOf(number: string): string | null {
    const row = db
      .prepare('SELECT tenant_id FROM provisioned_dids WHERE number = ?')
      .get(number) as { tenant_id: string } | undefined
    return row?.tenant_id ?? null
  },

  countActiveForTenant(tenantId: string): number {
    const row = db
      .prepare(
        "SELECT COUNT(*) as count FROM provisioned_dids WHERE tenant_id = ? AND status = 'active'"
      )
      .get(tenantId) as { count: number }
    return row.count
  },

  create(input: {
    tenantId: string
    number: string
    provider: string
    monthlyCents: number
    perMinuteCents: number
    mailboxId: string | null
  }): ProvisionedDid {
    const now = new Date().toISOString()
    const row: DidRow = {
      id: randomUUID(),
      tenant_id: input.tenantId,
      number: input.number,
      provider: input.provider,
      status: 'active',
      monthly_cents: input.monthlyCents,
      per_minute_cents: input.perMinuteCents,
      mailbox_id: input.mailboxId,
      created_at: now,
      released_at: null,
    }
    db.prepare(`
      INSERT INTO provisioned_dids (
        id, tenant_id, number, provider, status, monthly_cents, per_minute_cents,
        mailbox_id, created_at, released_at
      )
      VALUES (
        @id, @tenant_id, @number, @provider, @status, @monthly_cents, @per_minute_cents,
        @mailbox_id, @created_at, @released_at
      )
    `).run(row)
    return mapRow(row)
  },

  markReleased(number: string): void {
    db.prepare(
      "UPDATE provisioned_dids SET status = 'released', released_at = ? WHERE number = ?"
    ).run(new Date().toISOString(), number)
  },
}
