import { randomUUID } from 'node:crypto'
import { Router } from 'express'
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod/v4'
import {
  CallIntentSchema,
  CallStatusSchema,
  CallUpdateInputSchema,
  CreateAudioPromptRequestSchema,
  CreateGroupRequestSchema,
  CreateMailboxRequestSchema,
  CreateScheduledCallRequestSchema,
  CreateUserRequestSchema,
  SetGroupMailboxesRequestSchema,
  SetGroupMembersRequestSchema,
  UpdateEngineSettingsRequestSchema,
  UpdateGroupRequestSchema,
  UpdateMailboxRequestSchema,
  UpdateSipSettingsRequestSchema,
  UpdateUserRequestSchema,
  User,
} from '../../shared/src/index.js'

type ToolResult = {
  content: { type: 'text'; text: string }[]
}

type RecordingResource = {
  uri: string
  name: string
  mimeType: string
  description?: string
}

export type ComflowMcpDeps = {
  authenticateApiKey(token: string): User | null
  calls: {
    list(user: User, filters: unknown): unknown
    get(user: User, id: string): unknown
    update(user: User, id: string, input: unknown): Promise<unknown>
    addNote(user: User, id: string, input: unknown): unknown
  }
  scheduledCalls: {
    list(): unknown
    create(input: unknown): unknown
    cancel(id: string): unknown
  }
  prompts: {
    list(kind?: 'greeting' | 'outbound'): unknown
    upload(input: unknown): Promise<unknown>
    delete(id: string): Promise<void>
  }
  mailboxes: {
    list(user: User): unknown
    create(input: unknown): unknown
    update(id: string, input: unknown): unknown
    delete(id: string): void
  }
  settings: {
    get(): Promise<unknown> | unknown
    update(input: { engines?: unknown; sip?: unknown }): Promise<unknown> | unknown
  }
  users: {
    list(): unknown
    create(input: unknown): unknown
    update(id: string, input: unknown): unknown
    resetPassword(id: string, password: string): void
    delete(id: string, currentUser: User): void
  }
  groups: {
    list(): unknown
    create(input: unknown): unknown
    update(id: string, input: unknown): unknown
    delete(id: string): void
    setMembers(id: string, userIds: string[]): unknown
    setMailboxes(id: string, mailboxIds: string[]): unknown
  }
  recordings: {
    list(user: User): RecordingResource[]
    read(user: User, uri: URL): Promise<{
      uri: string
      mimeType: string
      blob: string
    }>
  }
}

const OptionalString = z.string().trim().min(1).optional()
const IdInput = z.object({ id: z.string().trim().min(1) })
const CallIdInput = z.object({ callId: z.string().trim().min(1) })

function jsonResult(value: unknown): ToolResult {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(value, null, 2),
      },
    ],
  }
}

function noContentResult(message: string): ToolResult {
  return jsonResult({ ok: true, message })
}

function requireAdmin(user: User) {
  if (user.role !== 'admin') {
    throw new Error('Administrator access required.')
  }
}

function bearerToken(header: string | undefined) {
  return header?.startsWith('Bearer ') ? header.slice(7) : null
}

function createServer(user: User, deps: ComflowMcpDeps) {
  const server = new McpServer(
    {
      name: 'comflow',
      version: '2.3.0',
    },
    {
      capabilities: {
        resources: {},
        tools: {},
      },
    }
  )

  server.registerTool(
    'list_calls',
    {
      description: 'List calls visible to the authenticated ComFlow user.',
      inputSchema: {
        status: CallStatusSchema.optional(),
        intent: CallIntentSchema.optional(),
        assignedQueue: OptionalString,
        q: OptionalString,
      },
      annotations: { readOnlyHint: true },
    },
    args => jsonResult({ items: deps.calls.list(user, args) })
  )

  server.registerTool(
    'get_call',
    {
      description: 'Get a call and its notes if visible to the authenticated user.',
      inputSchema: CallIdInput,
      annotations: { readOnlyHint: true },
    },
    args => jsonResult(deps.calls.get(user, args.callId))
  )

  server.registerTool(
    'update_call',
    {
      description: 'Update editable call fields.',
      inputSchema: z.object({
        callId: z.string().trim().min(1),
        patch: CallUpdateInputSchema,
      }),
    },
    async args => jsonResult({ call: await deps.calls.update(user, args.callId, args.patch) })
  )

  server.registerTool(
    'add_note',
    {
      description: 'Add a note to a call.',
      inputSchema: z.object({
        callId: z.string().trim().min(1),
        body: z.string().trim().min(1),
        authorName: z.string().trim().min(1).nullable().optional(),
      }),
    },
    args =>
      jsonResult({
        note: deps.calls.addNote(user, args.callId, {
          body: args.body,
          authorName: args.authorName,
        }),
      })
  )

  server.registerTool(
    'list_scheduled_call',
    {
      description: 'List scheduled calls.',
      annotations: { readOnlyHint: true },
    },
    () => jsonResult({ items: deps.scheduledCalls.list() })
  )

  server.registerTool(
    'create_scheduled_call',
    {
      description: 'Create a scheduled outbound call.',
      inputSchema: CreateScheduledCallRequestSchema,
    },
    args => jsonResult({ scheduledCall: deps.scheduledCalls.create(args) })
  )

  server.registerTool(
    'cancel_scheduled_call',
    {
      description: 'Cancel a scheduled outbound call.',
      inputSchema: IdInput,
    },
    args => jsonResult({ scheduledCall: deps.scheduledCalls.cancel(args.id) })
  )

  server.registerTool(
    'list_prompt',
    {
      description: 'List audio prompts.',
      inputSchema: {
        kind: z.enum(['greeting', 'outbound']).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    args => jsonResult({ items: deps.prompts.list(args.kind) })
  )

  server.registerTool(
    'upload_prompt',
    {
      description: 'Upload a base64-encoded audio prompt.',
      inputSchema: CreateAudioPromptRequestSchema,
    },
    async args => jsonResult({ prompt: await deps.prompts.upload(args) })
  )

  server.registerTool(
    'delete_prompt',
    {
      description: 'Delete an audio prompt.',
      inputSchema: IdInput,
    },
    async args => {
      await deps.prompts.delete(args.id)
      return noContentResult('Prompt deleted.')
    }
  )

  server.registerTool(
    'list_mailbox',
    {
      description: 'List mailboxes visible to the authenticated user.',
      annotations: { readOnlyHint: true },
    },
    () => jsonResult({ items: deps.mailboxes.list(user) })
  )

  server.registerTool(
    'create_mailbox',
    {
      description: 'Create a mailbox. Admin only.',
      inputSchema: CreateMailboxRequestSchema,
    },
    args => {
      requireAdmin(user)
      return jsonResult({ mailbox: deps.mailboxes.create(args) })
    }
  )

  server.registerTool(
    'update_mailbox',
    {
      description: 'Update a mailbox. Admin only.',
      inputSchema: z.object({
        id: z.string().trim().min(1),
        patch: UpdateMailboxRequestSchema,
      }),
    },
    args => {
      requireAdmin(user)
      return jsonResult({ mailbox: deps.mailboxes.update(args.id, args.patch) })
    }
  )

  server.registerTool(
    'delete_mailbox',
    {
      description: 'Delete a mailbox. Admin only.',
      inputSchema: IdInput,
    },
    args => {
      requireAdmin(user)
      deps.mailboxes.delete(args.id)
      return noContentResult('Mailbox deleted.')
    }
  )

  server.registerTool(
    'get_settings',
    {
      description: 'Get ComFlow engine and SIP settings. Admin only.',
      annotations: { readOnlyHint: true },
    },
    async () => {
      requireAdmin(user)
      return jsonResult(await deps.settings.get())
    }
  )

  server.registerTool(
    'update_settings',
    {
      description: 'Update ComFlow engine and/or SIP settings. Admin only.',
      inputSchema: z.object({
        engines: UpdateEngineSettingsRequestSchema.optional(),
        sip: UpdateSipSettingsRequestSchema.optional(),
      }),
    },
    async args => {
      requireAdmin(user)
      return jsonResult(await deps.settings.update(args))
    }
  )

  server.registerTool(
    'list_users',
    {
      description: 'List users. Admin only.',
      annotations: { readOnlyHint: true },
    },
    () => {
      requireAdmin(user)
      return jsonResult({ items: deps.users.list() })
    }
  )

  server.registerTool(
    'create_user',
    {
      description: 'Create a local user. Admin only.',
      inputSchema: CreateUserRequestSchema,
    },
    args => {
      requireAdmin(user)
      return jsonResult({ user: deps.users.create(args) })
    }
  )

  server.registerTool(
    'update_user',
    {
      description: 'Update a user. Admin only.',
      inputSchema: z.object({
        id: z.string().trim().min(1),
        patch: UpdateUserRequestSchema,
      }),
    },
    args => {
      requireAdmin(user)
      return jsonResult({ user: deps.users.update(args.id, args.patch) })
    }
  )

  server.registerTool(
    'reset_user_password',
    {
      description: 'Reset a local user password. Admin only.',
      inputSchema: z.object({
        id: z.string().trim().min(1),
        password: z.string().min(8).max(200),
      }),
    },
    args => {
      requireAdmin(user)
      deps.users.resetPassword(args.id, args.password)
      return noContentResult('Password reset.')
    }
  )

  server.registerTool(
    'delete_user',
    {
      description: 'Delete a user. Admin only.',
      inputSchema: IdInput,
    },
    args => {
      requireAdmin(user)
      deps.users.delete(args.id, user)
      return noContentResult('User deleted.')
    }
  )

  server.registerTool(
    'list_groups',
    {
      description: 'List groups. Admin only.',
      annotations: { readOnlyHint: true },
    },
    () => {
      requireAdmin(user)
      return jsonResult({ items: deps.groups.list() })
    }
  )

  server.registerTool(
    'create_group',
    {
      description: 'Create a group. Admin only.',
      inputSchema: CreateGroupRequestSchema,
    },
    args => {
      requireAdmin(user)
      return jsonResult({ group: deps.groups.create(args) })
    }
  )

  server.registerTool(
    'update_group',
    {
      description: 'Update a group. Admin only.',
      inputSchema: z.object({
        id: z.string().trim().min(1),
        patch: UpdateGroupRequestSchema,
      }),
    },
    args => {
      requireAdmin(user)
      return jsonResult({ group: deps.groups.update(args.id, args.patch) })
    }
  )

  server.registerTool(
    'delete_group',
    {
      description: 'Delete a group. Admin only.',
      inputSchema: IdInput,
    },
    args => {
      requireAdmin(user)
      deps.groups.delete(args.id)
      return noContentResult('Group deleted.')
    }
  )

  server.registerTool(
    'set_group_members',
    {
      description: 'Replace group members. Admin only.',
      inputSchema: z.object({
        id: z.string().trim().min(1),
        userIds: SetGroupMembersRequestSchema.shape.userIds,
      }),
    },
    args => {
      requireAdmin(user)
      return jsonResult({ group: deps.groups.setMembers(args.id, args.userIds) })
    }
  )

  server.registerTool(
    'set_group_mailboxes',
    {
      description: 'Replace group mailbox grants. Admin only.',
      inputSchema: z.object({
        id: z.string().trim().min(1),
        mailboxIds: SetGroupMailboxesRequestSchema.shape.mailboxIds,
      }),
    },
    args => {
      requireAdmin(user)
      return jsonResult({
        group: deps.groups.setMailboxes(args.id, args.mailboxIds),
      })
    }
  )

  server.registerResource(
    'recordings',
    new ResourceTemplate('comflow://recordings/{callId}', {
      list: () => ({ resources: deps.recordings.list(user) }),
    }),
    {
      title: 'Call recordings',
      description: 'Audio recordings visible to the authenticated ComFlow user.',
      mimeType: 'audio/wav',
    },
    async uri => ({ contents: [await deps.recordings.read(user, uri)] })
  )

  return server
}

export function createComflowMcpRouter(deps: ComflowMcpDeps) {
  const router = Router()

  router.all('/', async (request, response) => {
    const token = bearerToken(request.headers.authorization)
    if (!token?.startsWith('cf_')) {
      response.status(401).json({ error: 'A ComFlow API key is required.' })
      return
    }

    const user = deps.authenticateApiKey(token)
    if (!user) {
      response.status(401).json({ error: 'A ComFlow API key is required.' })
      return
    }

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    })
    const server = createServer(user, deps)

    try {
      await server.connect(transport)
      await transport.handleRequest(request, response, request.body)
    } catch (error) {
      if (!response.headersSent) {
        response.status(500).json({
          jsonrpc: '2.0',
          error: {
            code: -32603,
            message: (error as Error).message,
          },
          id: null,
        })
      }
    } finally {
      await server.close().catch(() => undefined)
    }
  })

  router.get('/health', (_request, response) => {
    response.json({ ok: true, transport: 'streamable-http', id: randomUUID() })
  })

  return router
}
