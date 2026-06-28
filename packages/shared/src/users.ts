import { z } from 'zod'
import { UserRoleSchema, UserSchema } from './auth.js'

export const CreateUserRequestSchema = z.object({
  email: z.string().trim().email(),
  displayName: z.string().trim().min(1).max(120).nullable().optional(),
  password: z.string().min(8).max(200),
  role: UserRoleSchema.default('member'),
})

export const UpdateUserRequestSchema = z
  .object({
    displayName: z.string().trim().min(1).max(120).nullable().optional(),
    role: UserRoleSchema.optional(),
  })
  .refine(value => Object.keys(value).length > 0, {
    message: 'At least one field is required.',
  })

export const ResetPasswordRequestSchema = z.object({
  password: z.string().min(8).max(200),
})

export const UpdateProfileSchema = z.object({
  displayName: z.string().trim().min(1).max(120).nullable(),
  email: z.string().trim().email(),
})

export const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(200),
})

export const UserListResponseSchema = z.object({
  items: z.array(UserSchema),
})

export const UserResponseSchema = z.object({
  user: UserSchema,
})

export type CreateUserRequest = z.infer<typeof CreateUserRequestSchema>
export type UpdateUserRequest = z.infer<typeof UpdateUserRequestSchema>
export type ResetPasswordRequest = z.infer<typeof ResetPasswordRequestSchema>
export type UpdateProfile = z.infer<typeof UpdateProfileSchema>
export type ChangePassword = z.infer<typeof ChangePasswordSchema>
export type UserListResponse = z.infer<typeof UserListResponseSchema>
export type UserResponse = z.infer<typeof UserResponseSchema>
