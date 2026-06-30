import { config } from '../../config.js'
import { FakeSipTrunkProvider } from './fake.js'
import { SipTrunkProvider } from './types.js'
import { VoipmsSipTrunkProvider } from './voipms.js'

/**
 * Pick the SIP trunk provider from config: VoIP.ms when its API credentials are
 * present (or explicitly selected), otherwise the in-memory fake for dev/tests.
 */
export function createSipTrunkProvider(): SipTrunkProvider {
  const { provider, voipms } = config.sipTrunk
  const voipmsConfigured = Boolean(voipms.apiUsername && voipms.apiPassword)

  if (provider === 'voipms' || (provider !== 'fake' && voipmsConfigured)) {
    if (!voipmsConfigured) {
      throw new Error(
        'COMFLOW_SIP_TRUNK_PROVIDER=voipms requires VOIPMS_API_USERNAME and VOIPMS_API_PASSWORD.'
      )
    }
    return new VoipmsSipTrunkProvider({
      apiUsername: voipms.apiUsername!,
      apiPassword: voipms.apiPassword!,
      subAccount: voipms.subAccount,
      defaultMonthlyCents: voipms.defaultMonthlyCents,
      defaultPerMinuteCents: voipms.defaultPerMinuteCents,
      defaultState: voipms.defaultState,
    })
  }

  return new FakeSipTrunkProvider()
}

export type { SipTrunkProvider } from './types.js'
