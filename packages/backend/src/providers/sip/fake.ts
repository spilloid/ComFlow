import { AvailableDid } from '../../../../shared/src/index.js'
import { OrderedDid, SipTrunkProvider } from './types.js'

/**
 * In-memory SIP trunk provider for dev and tests: a deterministic pool of
 * numbers, no network calls. Ordering removes a number from the pool; releasing
 * returns it. Default pricing mirrors VoIP.ms ballpark figures so usage math is
 * exercised realistically.
 */
export class FakeSipTrunkProvider implements SipTrunkProvider {
  readonly id = 'fake'

  private pool = new Map<string, AvailableDid>()
  private ordered = new Set<string>()

  constructor(seedNumbers: string[] = []) {
    const numbers = seedNumbers.length
      ? seedNumbers
      : Array.from({ length: 10 }, (_, i) => `+1555010${String(2000 + i)}`)
    for (const number of numbers) {
      this.pool.set(number, {
        number,
        description: 'Fake DID',
        region: 'US-TEST',
        setupCents: 0,
        monthlyCents: 85,
        perMinuteCents: 1,
      })
    }
  }

  async searchDids(input: { country: 'US' | 'CA'; query?: string }): Promise<
    AvailableDid[]
  > {
    void input.country
    return [...this.pool.values()].filter(
      did => !input.query || did.number.includes(input.query)
    )
  }

  async orderDid(number: string): Promise<OrderedDid> {
    const available = this.pool.get(number)
    if (!available) {
      throw new Error(`DID ${number} is not available to order.`)
    }
    this.pool.delete(number)
    this.ordered.add(number)
    return {
      number,
      monthlyCents: available.monthlyCents,
      perMinuteCents: available.perMinuteCents,
    }
  }

  async releaseDid(number: string): Promise<void> {
    this.ordered.delete(number)
    this.pool.set(number, {
      number,
      description: 'Fake DID',
      region: 'US-TEST',
      setupCents: 0,
      monthlyCents: 85,
      perMinuteCents: 1,
    })
  }
}
