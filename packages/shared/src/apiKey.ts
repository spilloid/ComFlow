import { z } from 'zod'

export const ApiKeySchema = z.object({
  id: z.string(),
  name: z.string(),
  prefix: z.string(),
  createdAt: z.string(),
  lastUsedAt: z.string().nullable(),
})

export const CreateApiKeyRequestSchema = z.object({
  name: z.string().trim().min(1).max(120),
})

export const ApiKeyListResponseSchema = z.object({
  items: z.array(ApiKeySchema),
})

export const CreateApiKeyResponseSchema = z.object({
  key: ApiKeySchema,
  plaintext: z.string(),
})

export type ApiKey = z.infer<typeof ApiKeySchema>
export type CreateApiKeyRequest = z.infer<typeof CreateApiKeyRequestSchema>
export type ApiKeyListResponse = z.infer<typeof ApiKeyListResponseSchema>
export type CreateApiKeyResponse = z.infer<typeof CreateApiKeyResponseSchema>
