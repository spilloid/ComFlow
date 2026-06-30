import { AvailableDid } from '../../../../shared/src/index.js'
import { OrderedDid, SipTrunkProvider } from './types.js'

const VOIPMS_REST_URL = 'https://voip.ms/api/v1/rest.php'

export type VoipmsConfig = {
  apiUsername: string
  apiPassword: string
  // The VoIP.ms sub-account ordered DIDs are routed to — the trunk our single
  // baresip registration answers. Routing string form: `account:<subaccount>`.
  subAccount: string
  // VoIP.ms cost defaults (cents) used to seed our usage pricing when the
  // provider doesn't echo per-DID pricing on order.
  defaultMonthlyCents: number
  defaultPerMinuteCents: number
  // Default state to search when no 2-letter state is supplied.
  defaultState: string
}

type VoipmsResponse = Record<string, unknown> & { status: string }

/**
 * VoIP.ms REST adapter. One shared account; ordered DIDs are routed to our
 * sub-account so the single baresip registration answers them all. Live calls
 * are validated in a VoIP.ms sandbox per the onboarding runbook — there is no
 * automated test against the real API.
 */
export class VoipmsSipTrunkProvider implements SipTrunkProvider {
  readonly id = 'voipms'

  constructor(private readonly config: VoipmsConfig) {}

  private async call(
    method: string,
    params: Record<string, string> = {}
  ): Promise<VoipmsResponse> {
    const url = new URL(VOIPMS_REST_URL)
    url.searchParams.set('api_username', this.config.apiUsername)
    url.searchParams.set('api_password', this.config.apiPassword)
    url.searchParams.set('method', method)
    url.searchParams.set('content_type', 'json')
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value)
    }

    const response = await fetch(url, { method: 'GET' })
    if (!response.ok) {
      throw new Error(`VoIP.ms ${method} HTTP ${response.status}.`)
    }
    const body = (await response.json()) as VoipmsResponse
    if (body.status !== 'success') {
      throw new Error(`VoIP.ms ${method} failed: ${body.status}`)
    }
    return body
  }

  async searchDids(input: { country: 'US' | 'CA'; query?: string }): Promise<
    AvailableDid[]
  > {
    // VoIP.ms searches by state/province + rate center. We treat a 2-letter
    // query as a state; otherwise fall back to the configured default state.
    const isState = input.query && /^[A-Za-z]{2}$/.test(input.query)
    const state = (isState ? input.query! : this.config.defaultState).toUpperCase()
    const method = input.country === 'CA' ? 'getDIDsCAN' : 'getDIDsUSA'

    const body = await this.call(method, { state })
    const dids = Array.isArray(body.dids) ? (body.dids as Record<string, unknown>[]) : []
    return dids.slice(0, 50).map(raw => ({
      number: String(raw.did ?? raw.number ?? ''),
      description: raw.ratecenter ? String(raw.ratecenter) : null,
      region: `${state}`,
      setupCents: dollarsToCents(raw.setup),
      monthlyCents: dollarsToCents(raw.monthly) || this.config.defaultMonthlyCents,
      perMinuteCents:
        dollarsToCents(raw.minute) || this.config.defaultPerMinuteCents,
    }))
  }

  async orderDid(number: string): Promise<OrderedDid> {
    await this.call('orderDID', {
      did: number,
      routing: `account:${this.config.subAccount}`,
      // Per-minute billing; ComFlow meters minutes and bills the wallet.
      billing_type: '1',
    })
    return {
      number,
      monthlyCents: this.config.defaultMonthlyCents,
      perMinuteCents: this.config.defaultPerMinuteCents,
    }
  }

  async releaseDid(number: string): Promise<void> {
    await this.call('cancelDID', { did: number })
  }
}

function dollarsToCents(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? Math.round(n * 100) : 0
}
