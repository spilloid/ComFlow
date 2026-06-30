import { AvailableDid } from '../../../../shared/src/index.js'

export type OrderedDid = {
  number: string
  monthlyCents: number
  perMinuteCents: number
}

/**
 * A SIP trunk provider that can search, order, route, and release DIDs over an
 * API. ComFlow runs one provider account shared across all tenants; per-tenant
 * separation comes from DID→mailbox→tenant routing, not separate trunks. VoIP.ms
 * is the first concrete adapter; a `fake` adapter backs dev and tests.
 */
export interface SipTrunkProvider {
  readonly id: string

  /** Numbers available to order (provider-priced). */
  searchDids(input: { country: 'US' | 'CA'; query?: string }): Promise<
    AvailableDid[]
  >

  /** Order a specific number and route it to our shared trunk/sub-account. */
  orderDid(number: string): Promise<OrderedDid>

  /** Release a number we previously ordered. */
  releaseDid(number: string): Promise<void>
}
