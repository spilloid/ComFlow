import path from 'node:path'
import fs from 'node:fs/promises'
import cors from 'cors'
import express, { NextFunction, Request, Response } from 'express'
import { User } from '../../shared/src/index.js'
import { createComflowMcpRouter } from '../../mcp/src/index.js'
import { createAuthRouter } from './routes/auth.js'
import { createCallsRouter } from './routes/calls.js'
import { createGroupsRouter } from './routes/groups.js'
import { createHealthRouter } from './routes/health.js'
import { createMailboxesRouter } from './routes/mailboxes.js'
import { createMeRouter } from './routes/me.js'
import { createPromptsRouter } from './routes/prompts.js'
import { createScheduledCallsRouter } from './routes/scheduledCalls.js'
import { createSettingsRouter } from './routes/settings.js'
import { createUsersRouter } from './routes/users.js'
import { createWebhookRouter } from './routes/webhooks.js'
import { config } from './config.js'
import { HttpError } from './lib/errors.js'
import { hashPassword } from './lib/password.js'
import { requireAdmin } from './middleware/requireAdmin.js'
import { requireAuth } from './middleware/requireAuth.js'
import { FakeTelephonyProvider } from './providers/telephony/fake.js'
import { seedFakeData } from './seed/fakeData.js'
import { AudioPromptService } from './services/audioPromptService.js'
import { AuthService } from './services/authService.js'
import { BaresipManagementService } from './services/baresipManagementService.js'
import { CallIngestionService } from './services/callIngestionService.js'
import { CallReviewService } from './services/callReviewService.js'
import { EmailNotificationService } from './services/emailNotificationService.js'
import { EngineService } from './services/engineService.js'
import { MailboxService } from './services/mailboxService.js'
import { ScheduledCallService } from './services/scheduledCallService.js'
import { SsoService } from './services/ssoService.js'
import { TelephonyGatewayService } from './services/telephonyGatewayService.js'
import { apiKeyService } from './services/apiKeyService.js'
import { callRepository } from './repositories/callRepository.js'
import { groupRepository } from './repositories/groupRepository.js'
import { userRepository } from './repositories/userRepository.js'
import { accessService } from './services/accessService.js'
import { toApiUser } from './services/authService.js'

export function createApp() {
  const app = express()
  const telephonyProvider = new FakeTelephonyProvider()
  const engineService = new EngineService()
  const emailNotificationService = new EmailNotificationService()
  const callIngestionService = new CallIngestionService(
    engineService,
    emailNotificationService
  )
  const callReviewService = new CallReviewService()
  const authService = new AuthService()
  const ssoService = new SsoService()
  const mailboxService = new MailboxService()
  authService.bootstrap()
  mailboxService.getDefault()

  // Real SIP edge: connect to baresip and drive answer/record/ingest directly.
  // In 'fake' mode the webhook endpoints remain the ingestion path.
  const audioPromptService = new AudioPromptService()
  const telephonyGateway = new TelephonyGatewayService(
    callIngestionService,
    audioPromptService
  )
  const baresipManagementService = new BaresipManagementService(
    telephonyGateway
  )
  const scheduledCallService = new ScheduledCallService(
    engineService,
    telephonyGateway,
    audioPromptService
  )

  function assertWithinDataDir(filePath: string, directory: string) {
    const resolvedFile = path.resolve(filePath)
    const resolvedDirectory = path.resolve(directory)
    if (
      resolvedFile !== resolvedDirectory &&
      !resolvedFile.startsWith(`${resolvedDirectory}${path.sep}`)
    ) {
      throw new HttpError(400, 'Invalid recording path.')
    }
    return resolvedFile
  }

  const mcpRouter = createComflowMcpRouter({
    authenticateApiKey(token) {
      return apiKeyService.resolve(token)?.user ?? null
    },
    calls: {
      list(user, filters) {
        return callReviewService.listCalls(filters as never, user)
      },
      get(user, id) {
        const detail = callReviewService.getCallDetail(id, user)
        return {
          ...detail,
          recordingResourceUri: detail.call.recordingPath
            ? `comflow://recordings/${detail.call.id}`
            : null,
        }
      },
      update(user, id, input) {
        return callReviewService.updateCall(id, input as never, user)
      },
      addNote(user, id, input) {
        return callReviewService.addNote(id, input as never, user)
      },
    },
    scheduledCalls: {
      list() {
        return scheduledCallService.list()
      },
      create(input) {
        return scheduledCallService.create(input as never)
      },
      cancel(id) {
        return scheduledCallService.cancel(id)
      },
    },
    prompts: {
      list(kind) {
        return audioPromptService.list(kind)
      },
      upload(input) {
        return audioPromptService.create(input as never)
      },
      delete(id) {
        return audioPromptService.delete(id)
      },
    },
    mailboxes: {
      list(user) {
        mailboxService.getDefault()
        return accessService.filterMailboxes(user, mailboxService.list())
      },
      create(input) {
        return mailboxService.create(input as never)
      },
      update(id, input) {
        return mailboxService.update(id, input as never)
      },
      delete(id) {
        mailboxService.remove(id)
      },
    },
    settings: {
      async get() {
        return {
          engines: engineService.getSettingsResponse(),
          sip: await baresipManagementService.getSettingsResponse(),
        }
      },
      async update(input) {
        return {
          engines: input.engines
            ? engineService.updateSettings(input.engines as never)
            : engineService.getSettingsResponse(),
          sip: input.sip
            ? await baresipManagementService.updateSettings(input.sip as never)
            : await baresipManagementService.getSettingsResponse(),
        }
      },
    },
    users: {
      list() {
        return userRepository.list().map(toApiUser)
      },
      create(input) {
        const userInput = input as {
          email: string
          displayName?: string | null
          password: string
          role: User['role']
        }
        if (userRepository.getByEmail(userInput.email)) {
          throw new HttpError(409, 'A user with that email already exists.')
        }
        return toApiUser(
          userRepository.create({
            email: userInput.email,
            displayName: userInput.displayName ?? null,
            passwordHash: hashPassword(userInput.password),
            role: userInput.role,
          })
        )
      },
      update(id, input) {
        const patch = input as { displayName?: string | null; role?: User['role'] }
        const existing = userRepository.getById(id)
        if (!existing) throw new HttpError(404, 'User not found.')
        if (
          patch.role === 'member' &&
          existing.role === 'admin' &&
          userRepository.countAdmins() <= 1
        ) {
          throw new HttpError(400, 'Cannot demote the last administrator.')
        }
        return toApiUser(userRepository.update(id, patch)!)
      },
      resetPassword(id, password) {
        if (!userRepository.getById(id)) throw new HttpError(404, 'User not found.')
        userRepository.setPassword(id, hashPassword(password))
      },
      delete(id, currentUser) {
        const existing = userRepository.getById(id)
        if (!existing) throw new HttpError(404, 'User not found.')
        if (currentUser.id === id) {
          throw new HttpError(400, 'You cannot delete your own account.')
        }
        if (existing.role === 'admin' && userRepository.countAdmins() <= 1) {
          throw new HttpError(400, 'Cannot delete the last administrator.')
        }
        userRepository.remove(id)
      },
    },
    groups: {
      list() {
        return groupRepository.listDetail()
      },
      create(input) {
        const group = groupRepository.create(input as never)
        return groupRepository.getDetail(group.id)
      },
      update(id, input) {
        const group = groupRepository.update(id, input as never)
        if (!group) throw new HttpError(404, 'Group not found.')
        return groupRepository.getDetail(id)
      },
      delete(id) {
        if (!groupRepository.remove(id)) {
          throw new HttpError(404, 'Group not found.')
        }
      },
      setMembers(id, userIds) {
        if (!groupRepository.getById(id)) throw new HttpError(404, 'Group not found.')
        groupRepository.setMembers(id, userIds)
        return groupRepository.getDetail(id)
      },
      setMailboxes(id, mailboxIds) {
        if (!groupRepository.getById(id)) throw new HttpError(404, 'Group not found.')
        groupRepository.setMailboxes(id, mailboxIds)
        return groupRepository.getDetail(id)
      },
    },
    recordings: {
      list(user) {
        return callRepository
          .list({})
          .map(call => callRepository.getById(call.id))
          .filter(call => Boolean(call))
          .filter(call => accessService.canAccessMailbox(user, call!.mailboxId))
          .filter(call => call!.recordingPath && call!.recordingStatus === 'ready')
          .map(call => ({
            uri: `comflow://recordings/${call!.id}`,
            name: `Recording ${call!.id}`,
            mimeType: call!.recordingMimeType ?? 'audio/wav',
            description: call!.summary ?? undefined,
          }))
      },
      async read(user, uri) {
        const id = uri.pathname.replace(/^\//, '')
        const detail = callReviewService.getCallDetail(id, user)
        if (!detail.call.recordingPath) {
          throw new HttpError(404, 'Recording not found.')
        }
        const absolutePath = assertWithinDataDir(
          path.resolve(config.dataDir, detail.call.recordingPath),
          config.recordingsDir
        )
        return {
          uri: uri.toString(),
          mimeType: detail.call.recordingMimeType ?? 'audio/wav',
          blob: (await fs.readFile(absolutePath)).toString('base64'),
        }
      },
    },
  })
  if (config.telephony.mode === 'baresip') {
    telephonyGateway.start()
    scheduledCallService.startScheduler()
  }

  if (config.seedDemo) {
    seedFakeData()
  }

  app.use(
    cors({
      origin: config.frontendOrigin,
    })
  )
  app.use(express.json({ limit: '10mb' }))

  // Open endpoints: health, auth, and webhooks (machine-to-machine).
  app.use('/api/health', createHealthRouter(engineService))
  app.use('/api/auth', createAuthRouter(authService, ssoService))
  app.use(
    '/api/webhooks',
    createWebhookRouter(telephonyProvider, callIngestionService)
  )
  app.use('/api/mcp', mcpRouter)

  // UI-facing endpoints, guarded by requireAuth (pass-through in open mode).
  app.use(
    '/api/settings',
    requireAuth,
    requireAdmin,
    createSettingsRouter(engineService, baresipManagementService)
  )
  app.use('/api/calls', requireAuth, createCallsRouter(callReviewService))
  app.use('/api/me', requireAuth, createMeRouter())
  app.use('/api/prompts', requireAuth, createPromptsRouter(audioPromptService))
  app.use(
    '/api/scheduled-calls',
    requireAuth,
    createScheduledCallsRouter(scheduledCallService)
  )
  app.use('/api/mailboxes', requireAuth, createMailboxesRouter(mailboxService))
  app.use('/api/groups', requireAuth, requireAdmin, createGroupsRouter())
  app.use('/api/users', requireAuth, requireAdmin, createUsersRouter())

  // Serve the built frontend (production single-image deploy). API routes above
  // win; everything else falls back to the SPA entry point.
  if (config.staticDir) {
    const staticDir = config.staticDir
    app.use(express.static(staticDir))
    app.get(/^(?!\/api\/).*/, (_request, response) => {
      response.sendFile(path.join(staticDir, 'index.html'))
    })
  }

  app.use(
    (
      error: unknown,
      _request: Request,
      response: Response,
      _next: NextFunction
    ) => {
      void _next

      if (error instanceof HttpError) {
        response.status(error.statusCode).json({ error: error.message })
        return
      }

      if (error instanceof Error) {
        response.status(500).json({ error: error.message })
        return
      }

      response.status(500).json({ error: 'Unknown server error.' })
    }
  )

  return app
}
