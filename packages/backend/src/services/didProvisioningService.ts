import {
  AvailableDid,
  ProvisionDidRequest,
  ProvisionedDid,
} from '../../../shared/src/index.js'
import { HttpError } from '../lib/errors.js'
import { didRepository } from '../repositories/didRepository.js'
import { mailboxRepository } from '../repositories/mailboxRepository.js'
import { createSipTrunkProvider, SipTrunkProvider } from '../providers/sip/index.js'

/**
 * Orders DIDs from the SIP trunk provider on the fly and binds them to a
 * tenant's mailbox. Because every DID routes to one shared trunk, "provisioning"
 * is: order the number, record it, and set a mailbox's `number` to it — inbound
 * routing ([resolveInbound]) then lands its calls in that tenant. Release
 * reverses it.
 */
export class DidProvisioningService {
  constructor(
    private readonly provider: SipTrunkProvider = createSipTrunkProvider()
  ) {}

  searchDids(input: { country: 'US' | 'CA'; query?: string }): Promise<
    AvailableDid[]
  > {
    return this.provider.searchDids(input)
  }

  listForTenant(tenantId: string): ProvisionedDid[] {
    return didRepository.listByTenant(tenantId)
  }

  async provision(
    tenantId: string,
    input: ProvisionDidRequest
  ): Promise<ProvisionedDid> {
    if (didRepository.getByNumber(input.number)) {
      throw new HttpError(409, 'That number is already provisioned.')
    }

    // Resolve the target mailbox first so a provider failure leaves no orphan.
    const mailboxId = this.resolveTargetMailbox(tenantId, input)

    const ordered = await this.provider.orderDid(input.number)

    mailboxRepository.update(mailboxId, { number: ordered.number })
    return didRepository.create({
      tenantId,
      number: ordered.number,
      provider: this.provider.id,
      monthlyCents: ordered.monthlyCents,
      perMinuteCents: ordered.perMinuteCents,
      mailboxId,
    })
  }

  async release(tenantId: string, number: string): Promise<void> {
    const did = didRepository.getByNumber(number)
    if (!did || didRepository.tenantIdOf(number) !== tenantId) {
      throw new HttpError(404, 'DID not found.')
    }
    if (did.status === 'released') return

    await this.provider.releaseDid(number)
    didRepository.markReleased(number)
    // Stop routing calls to the now-released number.
    if (did.mailboxId) {
      mailboxRepository.update(did.mailboxId, { number: null })
    }
  }

  private resolveTargetMailbox(
    tenantId: string,
    input: ProvisionDidRequest
  ): string {
    if (input.mailboxId) {
      const mailbox = mailboxRepository.getById(input.mailboxId)
      const inTenant = mailboxRepository
        .list(tenantId)
        .some(m => m.id === input.mailboxId)
      if (!mailbox || !inTenant) {
        throw new HttpError(404, 'Mailbox not found.')
      }
      return input.mailboxId
    }

    const mailbox = mailboxRepository.create({
      name: input.mailboxName ?? `Line ${input.number}`,
      number: null,
      sipAccountRef: null,
      greetingPromptId: null,
      tenantId,
    })
    return mailbox.id
  }
}
