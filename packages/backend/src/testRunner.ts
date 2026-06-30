import assert from 'node:assert/strict'
import { once } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { loadEnvFile } from './lib/envFile.js'
import { createSilentWav } from './lib/audio.js'

process.env.COMFLOW_SEED_DEMO = 'false'
process.env.PORT = '0'
process.env.COMFLOW_EMAIL_NOTIFICATIONS_ENABLED = 'false'
process.env.COMFLOW_OPENAI_API_KEY = 'env-openai-test-key'
process.env.COMFLOW_ANTHROPIC_API_KEY = ''
process.env.ANTHROPIC_API_KEY = ''
process.env.COMFLOW_ELEVENLABS_API_KEY = ''
process.env.ELEVENLABS_API_KEY = ''
process.env.COMFLOW_DEFAULT_LLM_PROVIDER = 'openai'
process.env.COMFLOW_DEFAULT_LLM_MODEL = 'gpt-4o-mini'
process.env.COMFLOW_DEFAULT_STT_PROVIDER = 'elevenlabs'
process.env.COMFLOW_DEFAULT_STT_MODEL = 'scribe_v2'
process.env.COMFLOW_DEFAULT_TTS_PROVIDER = 'openai'
process.env.COMFLOW_DEFAULT_TTS_MODEL = 'gpt-4o-mini-tts'
process.env.COMFLOW_DEFAULT_TTS_VOICE = 'alloy'
process.env.COMFLOW_DEFAULT_MAILBOX_NAME = 'Cluster mailbox'
process.env.COMFLOW_DEFAULT_MAILBOX_NUMBER = '+15550123'
process.env.COMFLOW_DEFAULT_MAILBOX_SIP_ACCOUNT_REF = 'cluster-sip-main'
const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'comflow-test-data-'))
process.env.COMFLOW_DATA_DIR = testDataDir
process.env.BARESIP_ACCOUNTS_PATH = path.join(
  testDataDir,
  'baresip',
  'accounts'
)
process.env.COMFLOW_SIP_AUTH_PASSWORD = ''
// Exercises the SSO admin allowlist (promote-on-login) in the provisioning test.
process.env.AUTH_ADMIN_EMAILS = 'boss@example.com'

async function getModules() {
  const [{ createApp }, { db, ensurePrimaryTenant }] = await Promise.all([
    import('./app.js'),
    import('./db/client.js'),
  ])

  return { createApp, db, ensurePrimaryTenant }
}

async function resetDb() {
  const { db } = await getModules()
  // Child tables first so deletes don't trip foreign-key constraints.
  db.exec(`
    DELETE FROM call_notes;
    DELETE FROM calls;
    DELETE FROM engine_settings;
    DELETE FROM engine_secret_overrides;
    DELETE FROM sip_settings;
    DELETE FROM group_members;
    DELETE FROM group_mailboxes;
    DELETE FROM sso_group_mappings;
    DELETE FROM sso_login_states;
    DELETE FROM groups;
    DELETE FROM users;
    DELETE FROM mailboxes;
  `)
  fs.rmSync(process.env.BARESIP_ACCOUNTS_PATH!, { force: true })
}

async function withServer<T>(run: (baseUrl: string) => Promise<T>) {
  const { createApp } = await getModules()
  const app = createApp()
  const server = app.listen(0)
  await once(server, 'listening')
  const address = server.address()
  const port =
    typeof address === 'object' && address ? address.port : undefined

  if (!port) {
    throw new Error('Could not determine test server port.')
  }

  try {
    return await run(`http://127.0.0.1:${port}`)
  } finally {
    server.close()
    await once(server, 'close')
  }
}

async function requestJson(
  baseUrl: string,
  pathname: string,
  init: RequestInit = {}
): Promise<{ response: Response; body: Record<string, unknown> | null }> {
  const response = await fetch(`${baseUrl}${pathname}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
    ...init,
  })
  const text = await response.text()
  return {
    response,
    body: text ? (JSON.parse(text) as Record<string, unknown>) : null,
  }
}

async function runTest(name: string, fn: () => Promise<void>) {
  await resetDb()

  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    console.error(`FAIL ${name}`)
    throw error
  }
}

async function main() {
  await runTest('env files are loaded without overriding real env vars', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'comflow-env-'))
    const envPath = path.join(tempDir, '.env')
    const unsetName = 'COMFLOW_ENV_FILE_TEST_VALUE'
    const presetName = 'COMFLOW_ENV_FILE_PRESET_VALUE'
    delete process.env[unsetName]
    process.env[presetName] = 'from-process'
    fs.writeFileSync(
      envPath,
      [
        `${unsetName}="from file"`,
        `${presetName}=from-file`,
        'COMFLOW_IGNORES_COMMENTS=value # local note',
      ].join('\n')
    )

    try {
      assert.equal(loadEnvFile(envPath), envPath)
      assert.equal(process.env[unsetName], 'from file')
      assert.equal(process.env[presetName], 'from-process')
      assert.equal(process.env.COMFLOW_IGNORES_COMMENTS, 'value')
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true })
      delete process.env[unsetName]
      delete process.env[presetName]
      delete process.env.COMFLOW_IGNORES_COMMENTS
    }
  })

  await runTest('defaults apply before any persisted settings', async () => {
    await withServer(async baseUrl => {
      const result = await requestJson(baseUrl, '/api/settings/engines')
      const body = result.body as {
        settings: {
          llm: { provider: string; model: string | null }
          stt: { provider: string }
          tts: { voice: string | null }
        }
        secrets: {
          openaiApiKey: { source: string; configured: boolean }
          elevenLabsApiKey: { source: string; configured: boolean }
        }
      }
      assert.equal(result.response.status, 200)
      assert.equal(body.settings.llm.provider, 'openai')
      assert.equal(body.settings.llm.model, 'gpt-4o-mini')
      assert.equal(body.settings.stt.provider, 'elevenlabs')
      assert.equal(body.settings.tts.voice, 'alloy')
      assert.equal(body.secrets.openaiApiKey.source, 'env')
      assert.equal(body.secrets.openaiApiKey.configured, true)
      assert.equal(body.secrets.elevenLabsApiKey.source, 'missing')
    })
  })

  await runTest('persisted settings override defaults and survive reloads', async () => {
    await withServer(async baseUrl => {
      const updated = await requestJson(baseUrl, '/api/settings/engines', {
        method: 'PATCH',
        body: JSON.stringify({
          llm: { provider: 'fake', model: null },
          stt: { provider: 'fake', model: null },
          tts: { provider: 'fake', model: null, voice: null },
        }),
      })
      const updatedBody = updated.body as {
        settings: { llm: { provider: string } }
      }

      assert.equal(updated.response.status, 200)
      assert.equal(updatedBody.settings.llm.provider, 'fake')

      const reloaded = await requestJson(baseUrl, '/api/settings/engines')
      const reloadedBody = reloaded.body as {
        settings: {
          llm: { provider: string }
          stt: { provider: string }
          tts: { provider: string }
        }
      }
      assert.equal(reloaded.response.status, 200)
      assert.equal(reloadedBody.settings.llm.provider, 'fake')
      assert.equal(reloadedBody.settings.stt.provider, 'fake')
      assert.equal(reloadedBody.settings.tts.provider, 'fake')
    })
  })

  await runTest('admin-entered secrets override missing env secrets', async () => {
    await withServer(async baseUrl => {
      const settings = {
        llm: { provider: 'anthropic', model: 'claude-sonnet-4-5' },
        stt: { provider: 'fake', model: null },
        tts: { provider: 'fake', model: null, voice: null },
      }

      const missing = await requestJson(baseUrl, '/api/settings/engines', {
        method: 'PATCH',
        body: JSON.stringify({ settings }),
      })
      const missingBody = missing.body as {
        readiness: { llm: { ready: boolean; missingSecrets: string[] } }
        secrets: { anthropicApiKey: { source: string } }
      }
      assert.equal(missing.response.status, 200)
      assert.equal(missingBody.readiness.llm.ready, false)
      assert.deepEqual(missingBody.readiness.llm.missingSecrets, [
        'COMFLOW_ANTHROPIC_API_KEY',
      ])
      assert.equal(missingBody.secrets.anthropicApiKey.source, 'missing')

      const saved = await requestJson(baseUrl, '/api/settings/engines', {
        method: 'PATCH',
        body: JSON.stringify({
          settings,
          secrets: { anthropicApiKey: 'admin-anthropic-key' },
        }),
      })
      const savedBody = saved.body as {
        readiness: { llm: { ready: boolean; missingSecrets: string[] } }
        secrets: { anthropicApiKey: { source: string; configured: boolean } }
      }
      assert.equal(saved.response.status, 200)
      assert.equal(savedBody.readiness.llm.ready, true)
      assert.deepEqual(savedBody.readiness.llm.missingSecrets, [])
      assert.equal(savedBody.secrets.anthropicApiKey.source, 'stored')
      assert.equal(savedBody.secrets.anthropicApiKey.configured, true)

      const reloaded = await requestJson(baseUrl, '/api/settings/engines')
      const reloadedBody = reloaded.body as {
        readiness: { llm: { ready: boolean } }
        secrets: { anthropicApiKey: { source: string } }
      }
      assert.equal(reloadedBody.readiness.llm.ready, true)
      assert.equal(reloadedBody.secrets.anthropicApiKey.source, 'stored')

      const cleared = await requestJson(baseUrl, '/api/settings/engines', {
        method: 'PATCH',
        body: JSON.stringify({
          settings,
          secrets: { anthropicApiKey: null },
        }),
      })
      const clearedBody = cleared.body as {
        readiness: { llm: { ready: boolean } }
        secrets: { anthropicApiKey: { source: string } }
      }
      assert.equal(clearedBody.readiness.llm.ready, false)
      assert.equal(clearedBody.secrets.anthropicApiKey.source, 'missing')
    })
  })

  await runTest('baresip account rendering uses the expected format', async () => {
    const { renderBaresipAccountLine } = await import(
      './services/baresipManagementService.js'
    )

    const line = renderBaresipAccountLine(
      {
        enabled: true,
        accountLabel: 'main',
        accountUri: 'sip:1001@pbx.example.com',
        authUsername: 'auth-1001',
        outboundProxy: 'sip:sbc.example.com',
        outboundDialingDomain: 'pbx.example.com',
        registrationInterval: 600,
        preferredCodecs: ['PCMU/8000/1', 'PCMA/8000/1'],
      },
      'sip-secret'
    )

    assert.equal(
      line,
      '"main" <sip:1001@pbx.example.com>;auth_user="auth-1001";auth_pass="sip-secret";outbound="sip:sbc.example.com";answermode=auto;regint=600;audio_codecs=PCMU/8000/1,PCMA/8000/1'
    )
  })

  await runTest('SIP settings write accounts file without API password leak', async () => {
    await withServer(async baseUrl => {
      const settings = {
        enabled: true,
        accountLabel: 'main',
        accountUri: 'sip:1001@pbx.example.com',
        authUsername: 'auth-1001',
        outboundProxy: 'sip:sbc.example.com',
        outboundDialingDomain: 'pbx.example.com',
        registrationInterval: 600,
        preferredCodecs: ['PCMU/8000/1', 'PCMA/8000/1'],
      }

      const saved = await requestJson(baseUrl, '/api/settings/sip', {
        method: 'PUT',
        body: JSON.stringify({
          settings,
          secrets: { authPassword: 'admin-sip-password' },
        }),
      })
      const savedText = JSON.stringify(saved.body)
      const savedBody = saved.body as {
        settings: { accountUri: string }
        secrets: { authPassword: { source: string; configured: boolean } }
        status: { accountsPath: string }
      }

      assert.equal(saved.response.status, 200)
      assert.equal(savedBody.settings.accountUri, 'sip:1001@pbx.example.com')
      assert.equal(savedBody.secrets.authPassword.source, 'stored')
      assert.equal(savedBody.secrets.authPassword.configured, true)
      assert.equal(savedText.includes('admin-sip-password'), false)
      assert.equal(
        savedBody.status.accountsPath,
        process.env.BARESIP_ACCOUNTS_PATH
      )

      const accounts = fs.readFileSync(
        process.env.BARESIP_ACCOUNTS_PATH!,
        'utf8'
      )
      assert.match(accounts, /<sip:1001@pbx\.example\.com>/)
      assert.match(accounts, /auth_pass="admin-sip-password"/)
      assert.match(accounts, /audio_codecs=PCMU\/8000\/1,PCMA\/8000\/1/)

      const reloaded = await requestJson(baseUrl, '/api/settings/sip')
      assert.equal(JSON.stringify(reloaded.body).includes('admin-sip-password'), false)
    })
  })

  await runTest('invalid SIP settings are rejected', async () => {
    await withServer(async baseUrl => {
      const result = await requestJson(baseUrl, '/api/settings/sip', {
        method: 'PUT',
        body: JSON.stringify({
          settings: {
            enabled: true,
            accountLabel: 'main',
            accountUri: 'not-a-sip-uri',
            authUsername: null,
            outboundProxy: null,
            outboundDialingDomain: null,
            registrationInterval: 600,
            preferredCodecs: [],
          },
          secrets: { authPassword: 'admin-sip-password' },
        }),
      })

      assert.equal(result.response.status, 400)
      assert.match(
        String((result.body as { error?: string } | null)?.error),
        /SIP account URI/
      )
    })
  })

  await runTest('mailbox env defaults apply on first boot', async () => {
    await withServer(async baseUrl => {
      const result = await requestJson(baseUrl, '/api/mailboxes')
      const body = result.body as {
        items: Array<{
          id: string
          name: string
          number: string | null
          sipAccountRef: string | null
        }>
      }
      const mailbox = body.items[0]

      assert.equal(result.response.status, 200)
      assert.ok(mailbox)
      assert.equal(mailbox.name, 'Cluster mailbox')
      assert.equal(mailbox.number, '+15550123')
      assert.equal(mailbox.sipAccountRef, 'cluster-sip-main')

      const updated = await requestJson(baseUrl, `/api/mailboxes/${mailbox.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: 'Admin mailbox',
          number: '+15550999',
          sipAccountRef: 'admin-sip',
        }),
      })
      const updatedBody = updated.body as {
        mailbox: {
          name: string
          number: string | null
          sipAccountRef: string | null
        }
      }

      assert.equal(updated.response.status, 200)
      assert.equal(updatedBody.mailbox.name, 'Admin mailbox')
      assert.equal(updatedBody.mailbox.number, '+15550999')
      assert.equal(updatedBody.mailbox.sipAccountRef, 'admin-sip')
    })
  })

  await runTest('invalid real-provider payloads are rejected', async () => {
    await withServer(async baseUrl => {
      const result = await requestJson(baseUrl, '/api/settings/engines', {
        method: 'PATCH',
        body: JSON.stringify({
          llm: { provider: 'openai', model: null },
          stt: { provider: 'fake', model: null },
          tts: { provider: 'fake', model: null, voice: null },
        }),
      })

      assert.equal(result.response.status, 400)
      assert.match(
        String((result.body as { error?: string } | null)?.error),
        /Model is required/
      )
    })
  })

  await runTest('recording ingestion uses fake engines when selected', async () => {
    await withServer(async baseUrl => {
      await requestJson(baseUrl, '/api/settings/engines', {
        method: 'PATCH',
        body: JSON.stringify({
          llm: { provider: 'fake', model: null },
          stt: { provider: 'fake', model: null },
          tts: { provider: 'fake', model: null, voice: null },
        }),
      })

      const accepted = await requestJson(baseUrl, '/api/webhooks/telephony/inbound', {
        method: 'POST',
        body: JSON.stringify({
          telephonyCallId: 'test-call-001',
          source: 'fake',
          fromNumber: '+1 555 100 2000',
          transcript:
            'Hi, this is Sarah Lee from Acme Health. We need urgent support with a portal outage. Please call me back at +1 555 100 2000.',
        }),
      })

      assert.equal(accepted.response.status, 202)

      const calls = await requestJson(baseUrl, '/api/calls')
      const callsBody = calls.body as {
        items: Array<{ intent: string; urgency: string }>
      }
      assert.equal(calls.response.status, 200)
      assert.equal(callsBody.items.length, 1)
      assert.equal(callsBody.items[0]?.intent, 'support_request')
      assert.equal(callsBody.items[0]?.urgency, 'high')
    })
  })

  await runTest('recordings can be downloaded with a stable filename', async () => {
    await withServer(async baseUrl => {
      await requestJson(baseUrl, '/api/settings/engines', {
        method: 'PATCH',
        body: JSON.stringify({
          llm: { provider: 'fake', model: null },
          stt: { provider: 'fake', model: null },
          tts: { provider: 'fake', model: null, voice: null },
        }),
      })

      const inbound = await requestJson(
        baseUrl,
        '/api/webhooks/telephony/inbound',
        {
          method: 'POST',
          body: JSON.stringify({
            telephonyCallId: 'download-call-001',
            source: 'fake',
            fromNumber: '+1 555 700 1000',
          }),
        }
      )
      assert.equal(inbound.response.status, 202)

      const completed = await requestJson(
        baseUrl,
        '/api/webhooks/telephony/recording-complete',
        {
          method: 'POST',
          body: JSON.stringify({
            telephonyCallId: 'download-call-001',
            recordingBase64: createSilentWav().toString('base64'),
            mimeType: 'audio/wav',
            transcript:
              'Hi, this is Riley from Atlas Dental. Please call me back about billing.',
          }),
        }
      )
      const completedBody = completed.body as { callId: string }
      assert.equal(completed.response.status, 202)

      const detail = await requestJson(
        baseUrl,
        `/api/calls/${completedBody.callId}`
      )
      const detailBody = detail.body as {
        recordingDownloadUrl: string | null
      }
      assert.equal(detail.response.status, 200)
      assert.ok(detailBody.recordingDownloadUrl)

      const download = await fetch(
        `${baseUrl}${detailBody.recordingDownloadUrl}`
      )
      assert.equal(download.status, 200)
      assert.match(
        download.headers.get('content-disposition') ?? '',
        /attachment; filename="comflow-voicemail-.*\.wav"/
      )
      assert.match(download.headers.get('content-type') ?? '', /audio\/wav/)
      assert.ok((await download.arrayBuffer()).byteLength > 0)
    })
  })

  await runTest('rbac scopes mailbox access and call lists', async () => {
    const { db, ensurePrimaryTenant } = await getModules()
    const { userRepository } = await import('./repositories/userRepository.js')
    const { groupRepository } = await import('./repositories/groupRepository.js')
    const { callRepository } = await import('./repositories/callRepository.js')
    const { accessService, ALL_MAILBOXES } = await import(
      './services/accessService.js'
    )
    const { CallReviewService } = await import('./services/callReviewService.js')

    const tenantId = ensurePrimaryTenant({ name: 'Primary', slug: 'primary' })
    const now = new Date().toISOString()
    const insertMailbox = db.prepare(`
      INSERT INTO mailboxes (id, name, number, greeting_prompt_id, sip_account_ref, tenant_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    insertMailbox.run('mb-a', 'Mailbox A', null, null, null, tenantId, now, now)
    insertMailbox.run('mb-b', 'Mailbox B', null, null, null, tenantId, now, now)

    const admin = userRepository.create({
      email: 'admin@example.com',
      displayName: 'Admin',
      passwordHash: null,
      role: 'admin',
      tenantId,
    })
    const member = userRepository.create({
      email: 'member@example.com',
      displayName: 'Member',
      passwordHash: null,
      role: 'member',
      tenantId,
    })

    const group = groupRepository.create({ name: 'Team A', tenantId })
    groupRepository.setMailboxes(group.id, ['mb-a'])
    groupRepository.setMembers(group.id, [member.id])

    assert.equal(accessService.accessibleMailboxIds(admin), ALL_MAILBOXES)
    assert.deepEqual(accessService.accessibleMailboxIds(member), ['mb-a'])

    const callA = callRepository.createInitial({
      telephonyCallId: 'c-a',
      source: 'fake',
      callbackNumber: null,
      mailboxId: 'mb-a',
      tenantId,
    })
    callRepository.createInitial({
      telephonyCallId: 'c-b',
      source: 'fake',
      callbackNumber: null,
      mailboxId: 'mb-b',
      tenantId,
    })

    const service = new CallReviewService()
    assert.deepEqual(
      service.listCalls({}, member).map(call => call.id),
      [callA.id]
    )
    assert.equal(service.listCalls({}, admin).length, 2)

    // The member can open their own call but not one in a mailbox they lack.
    assert.equal(service.getCallDetail(callA.id, member).call.id, callA.id)
    const callB = callRepository.getByTelephonyCallId('c-b')!
    assert.throws(
      () => service.getCallDetail(callB.id, member),
      /Call not found/
    )
  })

  await runTest('tenant isolation hides another tenant\'s calls', async () => {
    const { db, ensurePrimaryTenant } = await getModules()
    const { tenantRepository } = await import(
      './repositories/tenantRepository.js'
    )
    const { userRepository } = await import('./repositories/userRepository.js')
    const { callRepository } = await import('./repositories/callRepository.js')
    const { CallReviewService } = await import('./services/callReviewService.js')

    const tenantA = ensurePrimaryTenant({ name: 'Primary', slug: 'primary' })
    const tenantB = tenantRepository.create({ name: 'Acme', slug: 'acme' }).id

    const now = new Date().toISOString()
    const insertMailbox = db.prepare(`
      INSERT INTO mailboxes (id, name, number, greeting_prompt_id, sip_account_ref, tenant_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    insertMailbox.run('mb-a', 'A', null, null, null, tenantA, now, now)
    insertMailbox.run('mb-b', 'B', null, null, null, tenantB, now, now)

    // Each tenant's admin sees only their own mailbox's calls.
    const adminA = userRepository.create({
      email: 'a-admin@example.com',
      displayName: 'A',
      passwordHash: null,
      role: 'admin',
      tenantId: tenantA,
    })
    const adminB = userRepository.create({
      email: 'b-admin@example.com',
      displayName: 'B',
      passwordHash: null,
      role: 'admin',
      tenantId: tenantB,
    })

    const callA = callRepository.createInitial({
      telephonyCallId: 'iso-a',
      source: 'fake',
      callbackNumber: null,
      mailboxId: 'mb-a',
      tenantId: tenantA,
    })
    const callB = callRepository.createInitial({
      telephonyCallId: 'iso-b',
      source: 'fake',
      callbackNumber: null,
      mailboxId: 'mb-b',
      tenantId: tenantB,
    })

    const service = new CallReviewService()
    assert.deepEqual(
      service.listCalls({}, adminA).map(call => call.id),
      [callA.id]
    )
    assert.deepEqual(
      service.listCalls({}, adminB).map(call => call.id),
      [callB.id]
    )
    // Admin A cannot open tenant B's call — 404, not a leak.
    assert.throws(
      () => service.getCallDetail(callB.id, adminA),
      /Call not found/
    )
  })

  await runTest('did provisioning binds a DID to a mailbox and reverses', async () => {
    const { ensurePrimaryTenant } = await getModules()
    const { DidProvisioningService } = await import(
      './services/didProvisioningService.js'
    )
    const { FakeSipTrunkProvider } = await import('./providers/sip/fake.js')
    const { mailboxRepository } = await import(
      './repositories/mailboxRepository.js'
    )
    const { didRepository } = await import('./repositories/didRepository.js')

    const tenantId = ensurePrimaryTenant({ name: 'Primary', slug: 'primary' })
    const service = new DidProvisioningService(
      new FakeSipTrunkProvider(['+15550102000'])
    )

    const did = await service.provision(tenantId, {
      number: '+15550102000',
      mailboxName: 'Forwarded line',
    })
    assert.equal(did.number, '+15550102000')
    assert.equal(did.status, 'active')
    assert.ok(did.mailboxId)

    // A mailbox now routes that DID, scoped to the tenant.
    const mailbox = mailboxRepository.getByNumber('+15550102000')
    assert.ok(mailbox)
    assert.equal(mailbox!.id, did.mailboxId)
    assert.deepEqual(
      service.listForTenant(tenantId).map(d => d.number),
      ['+15550102000']
    )

    // Double-provisioning the same number is rejected.
    await assert.rejects(
      () => service.provision(tenantId, { number: '+15550102000' }),
      /already provisioned/
    )

    // Releasing reverses routing and marks the DID released.
    await service.release(tenantId, '+15550102000')
    assert.equal(didRepository.getByNumber('+15550102000')!.status, 'released')
    assert.equal(mailboxRepository.getByNumber('+15550102000'), null)
  })

  await runTest('requireAdmin blocks non-admins', async () => {
    const { requireAdmin } = await import('./middleware/requireAdmin.js')

    function run(role: 'admin' | 'member') {
      const result = { status: 0, nexted: false }
      const response = {
        locals: {
          user: {
            id: 'u',
            email: 'e@example.com',
            displayName: null,
            role,
            authProvider: 'local',
          },
        },
        status(code: number) {
          result.status = code
          return this
        },
        json() {
          return this
        },
      }
      requireAdmin({} as never, response as never, () => {
        result.nexted = true
      })
      return result
    }

    const member = run('member')
    assert.equal(member.status, 403)
    assert.equal(member.nexted, false)

    const admin = run('admin')
    assert.equal(admin.nexted, true)
  })

  await runTest(
    'sso provisioning creates users, promotes admins, syncs mapped groups',
    async () => {
      const { SsoService } = await import('./services/ssoService.js')
      const { groupRepository } = await import(
        './repositories/groupRepository.js'
      )
      const { userRepository } = await import('./repositories/userRepository.js')
      const { ensurePrimaryTenant } = await import('./db/client.js')
      type SsoIdentity = import('./providers/auth/types.js').SsoIdentity
      type SsoProvider = import('./providers/auth/types.js').SsoProvider

      const tenantId = ensurePrimaryTenant({ name: 'Primary', slug: 'primary' })
      const opsGroup = groupRepository.create({ name: 'Ops', tenantId })
      groupRepository.setMappings([
        { externalName: 'ops', groupId: opsGroup.id },
      ])

      class FakeProvider implements SsoProvider {
        readonly id = 'oidc' as const
        readonly label = 'Fake'
        constructor(private readonly identity: SsoIdentity) {}
        async start() {
          return {
            redirectUrl: 'https://idp/authorize',
            state: `state-${this.identity.email}`,
            nonce: null,
            codeVerifier: null,
          }
        }
        async complete() {
          return this.identity
        }
      }

      // boss is in AUTH_ADMIN_EMAILS and carries the mapped "ops" group.
      const bossSvc = new SsoService([
        new FakeProvider({
          email: 'boss@example.com',
          displayName: 'Boss',
          externalId: 'sub-boss',
          groups: ['ops'],
        }),
      ])
      await bossSvc.start('oidc')
      const boss = await bossSvc.complete('oidc', {
        callbackUrl: 'https://app/cb',
        state: 'state-boss@example.com',
      })
      assert.equal(boss.user.email, 'boss@example.com')
      assert.equal(boss.user.role, 'admin')
      assert.ok(boss.token)
      assert.ok(
        groupRepository
          .getDetail(opsGroup.id)!
          .members.some(m => m.email === 'boss@example.com')
      )

      // A non-allowlisted user with no mapped groups stays a member.
      const workerSvc = new SsoService([
        new FakeProvider({
          email: 'worker@example.com',
          displayName: 'Worker',
          externalId: 'sub-worker',
          groups: [],
        }),
      ])
      await workerSvc.start('oidc')
      const worker = await workerSvc.complete('oidc', {
        callbackUrl: 'https://app/cb',
        state: 'state-worker@example.com',
      })
      assert.equal(worker.user.role, 'member')
      assert.equal(userRepository.getByEmail('worker@example.com')?.authProvider, 'oidc')
    }
  )

  await runTest('auth providers endpoint reflects config', async () => {
    await withServer(async baseUrl => {
      const providers = await requestJson(baseUrl, '/api/auth/providers')
      const providersBody = providers.body as {
        localEnabled: boolean
        providers: unknown[]
      }
      assert.equal(providers.response.status, 200)
      assert.equal(providersBody.localEnabled, true)
      assert.deepEqual(providersBody.providers, [])

      const me = await requestJson(baseUrl, '/api/auth/me')
      const meBody = me.body as {
        authRequired: boolean
        localEnabled: boolean
        providers: unknown[]
      }
      assert.equal(meBody.authRequired, false)
      assert.equal(meBody.localEnabled, true)
      assert.deepEqual(meBody.providers, [])
    })
  })

  await runTest('groups can be created and granted mailboxes', async () => {
    await withServer(async baseUrl => {
      const mailboxes = await requestJson(baseUrl, '/api/mailboxes')
      const mailboxId = (mailboxes.body as { items: { id: string }[] })
        .items[0]!.id

      const created = await requestJson(baseUrl, '/api/groups', {
        method: 'POST',
        body: JSON.stringify({ name: 'Support' }),
      })
      assert.equal(created.response.status, 201)
      const groupId = (created.body as { group: { id: string } }).group.id

      const granted = await requestJson(
        baseUrl,
        `/api/groups/${groupId}/mailboxes`,
        { method: 'PUT', body: JSON.stringify({ mailboxIds: [mailboxId] }) }
      )
      assert.equal(granted.response.status, 200)
      const grantedBody = granted.body as {
        group: { mailboxes: { id: string }[] }
      }
      assert.deepEqual(
        grantedBody.group.mailboxes.map(mailbox => mailbox.id),
        [mailboxId]
      )

      const list = await requestJson(baseUrl, '/api/groups')
      assert.equal((list.body as { items: unknown[] }).items.length, 1)
    })
  })

  await runTest('inbound calls route to a mailbox by dialed DID', async () => {
    await withServer(async baseUrl => {
      await requestJson(baseUrl, '/api/settings/engines', {
        method: 'PATCH',
        body: JSON.stringify({
          llm: { provider: 'fake', model: null },
          stt: { provider: 'fake', model: null },
          tts: { provider: 'fake', model: null, voice: null },
        }),
      })

      const initial = await requestJson(baseUrl, '/api/mailboxes')
      const defaultMailboxId = (initial.body as { items: { id: string }[] })
        .items[0]!.id

      const created = await requestJson(baseUrl, '/api/mailboxes', {
        method: 'POST',
        body: JSON.stringify({ name: 'Sales', number: '+19998887777' }),
      })
      const salesMailboxId = (created.body as { mailbox: { id: string } })
        .mailbox.id

      // A call dialing the Sales DID lands in the Sales mailbox.
      await requestJson(baseUrl, '/api/webhooks/telephony/inbound', {
        method: 'POST',
        body: JSON.stringify({
          telephonyCallId: 'route-sales',
          source: 'fake',
          fromNumber: '+15551112222',
          toNumber: '+19998887777',
          transcript: 'Hi, calling about a sales quote.',
        }),
      })
      // A call with no/unknown DID falls back to the default mailbox.
      await requestJson(baseUrl, '/api/webhooks/telephony/inbound', {
        method: 'POST',
        body: JSON.stringify({
          telephonyCallId: 'route-default',
          source: 'fake',
          fromNumber: '+15553334444',
          transcript: 'Hi, just a general question.',
        }),
      })

      const list = await requestJson(baseUrl, '/api/calls')
      const items = (list.body as { items: { id: string }[] }).items
      const mailboxOf = async (telephonyCallId: string) => {
        for (const item of items) {
          const detail = await requestJson(baseUrl, `/api/calls/${item.id}`)
          const call = (detail.body as { call: { telephonyCallId: string; mailboxId: string } }).call
          if (call.telephonyCallId === telephonyCallId) return call.mailboxId
        }
        return null
      }

      assert.equal(await mailboxOf('route-sales'), salesMailboxId)
      assert.equal(await mailboxOf('route-default'), defaultMailboxId)
    })
  })

  await runTest('mailboxes can be created but never the last deleted', async () => {
    await withServer(async baseUrl => {
      const before = await requestJson(baseUrl, '/api/mailboxes')
      const defaultId = (before.body as { items: { id: string }[] }).items[0]!.id

      const created = await requestJson(baseUrl, '/api/mailboxes', {
        method: 'POST',
        body: JSON.stringify({ name: 'Support', number: '+18005551234' }),
      })
      assert.equal(created.response.status, 201)
      const supportId = (created.body as { mailbox: { id: string } }).mailbox.id

      const two = await requestJson(baseUrl, '/api/mailboxes')
      assert.equal((two.body as { items: unknown[] }).items.length, 2)

      const del = await fetch(`${baseUrl}/api/mailboxes/${supportId}`, {
        method: 'DELETE',
      })
      assert.equal(del.status, 204)

      // Deleting the only remaining mailbox is refused.
      const delLast = await requestJson(baseUrl, `/api/mailboxes/${defaultId}`, {
        method: 'DELETE',
      })
      assert.equal(delLast.response.status, 400)
      assert.match(
        String((delLast.body as { error?: string } | null)?.error),
        /only mailbox/
      )
    })
  })

  await runTest('user management creates users and protects the last admin', async () => {
    await withServer(async baseUrl => {
      const admin = await requestJson(baseUrl, '/api/users', {
        method: 'POST',
        body: JSON.stringify({
          email: 'admin@example.com',
          password: 'supersecret',
          role: 'admin',
        }),
      })
      assert.equal(admin.response.status, 201)
      const adminId = (admin.body as { user: { id: string } }).user.id

      const member = await requestJson(baseUrl, '/api/users', {
        method: 'POST',
        body: JSON.stringify({
          email: 'member@example.com',
          password: 'supersecret',
          role: 'member',
        }),
      })
      assert.equal(member.response.status, 201)

      const list = await requestJson(baseUrl, '/api/users')
      assert.equal((list.body as { items: unknown[] }).items.length, 2)

      // The new member is assignable to groups.
      const assignable = await requestJson(baseUrl, '/api/groups/users')
      assert.ok(
        (assignable.body as { items: { email: string }[] }).items.some(
          u => u.email === 'member@example.com'
        )
      )

      // The sole admin can't be demoted or deleted.
      const demote = await requestJson(baseUrl, `/api/users/${adminId}`, {
        method: 'PATCH',
        body: JSON.stringify({ role: 'member' }),
      })
      assert.equal(demote.response.status, 400)
      const remove = await requestJson(baseUrl, `/api/users/${adminId}`, {
        method: 'DELETE',
      })
      assert.equal(remove.response.status, 400)
    })
  })

  await runTest('reviewing a call records who reviewed it', async () => {
    await withServer(async baseUrl => {
      await requestJson(baseUrl, '/api/settings/engines', {
        method: 'PATCH',
        body: JSON.stringify({
          llm: { provider: 'fake', model: null },
          stt: { provider: 'fake', model: null },
          tts: { provider: 'fake', model: null, voice: null },
        }),
      })
      await requestJson(baseUrl, '/api/webhooks/telephony/inbound', {
        method: 'POST',
        body: JSON.stringify({
          telephonyCallId: 'attrib-1',
          source: 'fake',
          fromNumber: '+15550000000',
          transcript: 'Please call me back.',
        }),
      })

      const list = await requestJson(baseUrl, '/api/calls')
      const callId = (list.body as { items: { id: string }[] }).items[0]!.id

      await requestJson(baseUrl, `/api/calls/${callId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'reviewed' }),
      })

      const detail = await requestJson(baseUrl, `/api/calls/${callId}`)
      const call = (detail.body as { call: { reviewedBy: string | null } }).call
      // Open-mode identity reviews as "Open Mode".
      assert.equal(call.reviewedBy, 'Open Mode')
    })
  })

  const { db } = await getModules()
  db.close()
  fs.rmSync(testDataDir, { recursive: true, force: true })
}

void main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
