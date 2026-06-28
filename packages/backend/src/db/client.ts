import fs from 'node:fs'
import Database from 'better-sqlite3'
import { config } from '../config.js'

fs.mkdirSync(config.recordingsDir, { recursive: true })
fs.mkdirSync(config.rawRecordingsDir, { recursive: true })
fs.mkdirSync(config.greetingsDir, { recursive: true })
fs.mkdirSync(config.outboundAudioDir, { recursive: true })
fs.mkdirSync(config.promptsDir, { recursive: true })

export const db = new Database(config.databasePath)

db.pragma('journal_mode = WAL')
// Enforce foreign keys so RBAC cascade deletes (e.g. removing a group clears its
// memberships and mailbox grants) actually fire.
db.pragma('foreign_keys = ON')

db.exec(`
  CREATE TABLE IF NOT EXISTS calls (
    id TEXT PRIMARY KEY,
    telephony_call_id TEXT UNIQUE,
    source TEXT NOT NULL,
    caller_name TEXT,
    company TEXT,
    callback_number TEXT,
    intent TEXT NOT NULL,
    urgency TEXT NOT NULL,
    summary TEXT,
    transcript TEXT,
    raw_transcript TEXT,
    status TEXT NOT NULL,
    assigned_queue TEXT,
    recording_status TEXT NOT NULL,
    recording_path TEXT,
    recording_mime_type TEXT,
    reviewed_at TEXT,
    synced_ticket_id TEXT,
    synced_ticket_provider TEXT,
    synced_at TEXT,
    email_notified_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS call_notes (
    id TEXT PRIMARY KEY,
    call_id TEXT NOT NULL,
    body TEXT NOT NULL,
    author_name TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (call_id) REFERENCES calls(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS engine_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    llm_provider TEXT NOT NULL,
    llm_model TEXT,
    stt_provider TEXT NOT NULL,
    stt_model TEXT,
    tts_provider TEXT NOT NULL,
    tts_model TEXT,
    tts_voice TEXT,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS engine_secret_overrides (
    secret_key TEXT PRIMARY KEY,
    secret_value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sip_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    enabled INTEGER NOT NULL,
    account_label TEXT NOT NULL,
    account_uri TEXT,
    auth_username TEXT,
    outbound_proxy TEXT,
    outbound_dialing_domain TEXT,
    registration_interval INTEGER NOT NULL,
    preferred_codecs_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS scheduled_calls (
    id TEXT PRIMARY KEY,
    to_number TEXT NOT NULL,
    scheduled_at TEXT NOT NULL,
    message_text TEXT NOT NULL,
    question_text TEXT NOT NULL,
    message_prompt_id TEXT,
    question_prompt_id TEXT,
    status TEXT NOT NULL,
    answer_transcript TEXT,
    answer_recording_path TEXT,
    provider_call_id TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS audio_prompts (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    kind TEXT NOT NULL,
    audio_path TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    display_name TEXT,
    password_hash TEXT,
    role TEXT NOT NULL,
    auth_provider TEXT NOT NULL DEFAULT 'local',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS api_keys (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    prefix TEXT NOT NULL,
    key_hash TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    last_used_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS mailboxes (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    number TEXT,
    greeting_prompt_id TEXT,
    sip_account_ref TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  -- RBAC (M3): groups grant mailbox visibility. Admins see everything; members
  -- see only the mailboxes their groups grant.
  CREATE TABLE IF NOT EXISTS groups (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS group_members (
    group_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    PRIMARY KEY (group_id, user_id),
    FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS group_mailboxes (
    group_id TEXT NOT NULL,
    mailbox_id TEXT NOT NULL,
    PRIMARY KEY (group_id, mailbox_id),
    FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
    FOREIGN KEY (mailbox_id) REFERENCES mailboxes(id) ON DELETE CASCADE
  );

  -- Maps an IdP group name (from an SSO assertion) onto a ComFlow group, so
  -- membership can be synced on every SSO login.
  CREATE TABLE IF NOT EXISTS sso_group_mappings (
    external_name TEXT PRIMARY KEY,
    group_id TEXT NOT NULL,
    FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE
  );

  -- Transient CSRF/nonce store for the SSO redirect round-trip. Rows are
  -- consumed (deleted) on callback; stale rows are swept by age.
  CREATE TABLE IF NOT EXISTS sso_login_states (
    state TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    nonce TEXT,
    code_verifier TEXT,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_calls_created_at ON calls(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_calls_status ON calls(status);
  CREATE INDEX IF NOT EXISTS idx_calls_intent ON calls(intent);
  CREATE INDEX IF NOT EXISTS idx_calls_assigned_queue ON calls(assigned_queue);
  CREATE INDEX IF NOT EXISTS idx_call_notes_call_id_created_at ON call_notes(call_id, created_at ASC);
  CREATE INDEX IF NOT EXISTS idx_scheduled_calls_status_due ON scheduled_calls(status, scheduled_at ASC);
  CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON api_keys(user_id);
  CREATE INDEX IF NOT EXISTS idx_api_keys_key_hash ON api_keys(key_hash);
`)

// Lightweight migrations for databases created before a column existed.
function addColumnIfMissing(table: string, column: string, definition: string) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as {
    name: string
  }[]
  if (!columns.some(c => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
  }
}

addColumnIfMissing('calls', 'synced_ticket_id', 'TEXT')
addColumnIfMissing('calls', 'synced_ticket_provider', 'TEXT')
addColumnIfMissing('calls', 'synced_at', 'TEXT')
addColumnIfMissing('scheduled_calls', 'message_prompt_id', 'TEXT')
addColumnIfMissing('scheduled_calls', 'question_prompt_id', 'TEXT')
addColumnIfMissing('calls', 'mailbox_id', 'TEXT')
addColumnIfMissing('calls', 'email_notified_at', 'TEXT')
// Snapshot of the operator who reviewed/assigned the call (display name or email).
addColumnIfMissing('calls', 'reviewed_by', 'TEXT')
// Links a local user row to an external SSO identity (subject/nameID).
addColumnIfMissing('users', 'external_id', 'TEXT')
