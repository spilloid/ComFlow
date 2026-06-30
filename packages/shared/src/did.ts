import { z } from 'zod'

// A DID (phone number) the customer forwards their calls to. Provisioned on the
// fly from a SIP trunk provider (VoIP.ms first), routed to the shared trunk, and
// bound to a tenant's mailbox. Costs are tracked in integer cents.
export const DidStatusSchema = z.enum(['active', 'released'])

/** A number available to order, returned by a provider search. */
export const AvailableDidSchema = z.object({
  number: z.string(),
  description: z.string().nullable(),
  // Rough location hints when the provider supplies them.
  region: z.string().nullable(),
  setupCents: z.number().int(),
  monthlyCents: z.number().int(),
  perMinuteCents: z.number().int(),
})

/** A DID we have ordered and bound to a mailbox. */
export const ProvisionedDidSchema = z.object({
  id: z.string(),
  number: z.string(),
  provider: z.string(),
  status: DidStatusSchema,
  monthlyCents: z.number().int(),
  perMinuteCents: z.number().int(),
  mailboxId: z.string().nullable(),
  createdAt: z.string(),
  releasedAt: z.string().nullable(),
})

export const SearchDidsRequestSchema = z.object({
  country: z.enum(['US', 'CA']).default('US'),
  // A 3-digit area code (NPA) or partial-match query, provider-dependent.
  query: z.string().trim().max(32).optional(),
})

export const ProvisionDidRequestSchema = z.object({
  number: z.string().trim().min(3).max(32),
  // Create a new mailbox for this DID (with this name), or attach to an
  // existing mailbox by id.
  mailboxName: z.string().trim().min(1).max(120).optional(),
  mailboxId: z.string().trim().min(1).optional(),
})

export const SearchDidsResponseSchema = z.object({
  items: z.array(AvailableDidSchema),
})

export const GetProvisionedDidsResponseSchema = z.object({
  items: z.array(ProvisionedDidSchema),
})

export const ProvisionDidResponseSchema = z.object({
  did: ProvisionedDidSchema,
})

export type DidStatus = z.infer<typeof DidStatusSchema>
export type AvailableDid = z.infer<typeof AvailableDidSchema>
export type ProvisionedDid = z.infer<typeof ProvisionedDidSchema>
export type SearchDidsRequest = z.infer<typeof SearchDidsRequestSchema>
export type ProvisionDidRequest = z.infer<typeof ProvisionDidRequestSchema>
export type SearchDidsResponse = z.infer<typeof SearchDidsResponseSchema>
export type GetProvisionedDidsResponse = z.infer<
  typeof GetProvisionedDidsResponseSchema
>
export type ProvisionDidResponse = z.infer<typeof ProvisionDidResponseSchema>
