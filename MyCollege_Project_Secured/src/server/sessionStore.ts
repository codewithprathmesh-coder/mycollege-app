import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import 'dotenv/config';
import type { User } from '../types/index.ts';

export interface SessionRecord {
  token: string;
  userId: string;
  authUserId: string;
  email: string;
  supabaseAccessToken: string;
  supabaseRefreshToken: string;
  createdAt: number;
  expiresAt: number;
  userSnapshot: User;
}

interface SessionPayload {
  supabaseAccessToken: string;
  supabaseRefreshToken: string;
  userSnapshot: User;
}

interface StoredSessionRow {
  profile_id: string;
  auth_user_id: string;
  encrypted_data: string;
  created_at: string;
  expires_at: string;
}

interface SessionStoreConfig {
  client: SupabaseClient;
  encryptionKey: Buffer;
}

let cachedConfig: SessionStoreConfig | undefined;

function getSessionStoreConfig(): SessionStoreConfig {
  if (cachedConfig) return cachedConfig;

  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const encodedEncryptionKey = process.env.SESSION_ENCRYPTION_KEY?.trim();
  if (!url || !serviceRoleKey || !encodedEncryptionKey) {
    throw new Error(
      'Persistent sessions are not configured. Set SUPABASE_SERVICE_ROLE_KEY and SESSION_ENCRYPTION_KEY on the server.'
    );
  }

  const encryptionKey = Buffer.from(encodedEncryptionKey, 'base64');
  if (
    encryptionKey.length !== 32 ||
    encryptionKey.toString('base64') !== encodedEncryptionKey
  ) {
    throw new Error('SESSION_ENCRYPTION_KEY must be a base64-encoded 32-byte key.');
  }

  cachedConfig = {
    client: createClient(url, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    }),
    encryptionKey,
  };
  return cachedConfig;
}

function sessionTokenHash(token: string, key: Buffer): string {
  return createHmac('sha256', key).update(token).digest('hex');
}

function encryptSessionPayload(
  payload: SessionPayload,
  key: Buffer,
  tokenHash: string
): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(tokenHash, 'utf8'));
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(payload), 'utf8'),
    cipher.final(),
  ]);
  return [
    iv.toString('base64'),
    cipher.getAuthTag().toString('base64'),
    encrypted.toString('base64'),
  ].join('.');
}

function decryptSessionPayload(
  value: string,
  key: Buffer,
  tokenHash: string
): SessionPayload {
  const [encodedIv, encodedTag, encodedData, extra] = value.split('.');
  if (!encodedIv || !encodedTag || !encodedData || extra !== undefined) {
    throw new Error('Stored session data has an invalid encrypted format.');
  }
  const iv = Buffer.from(encodedIv, 'base64');
  const tag = Buffer.from(encodedTag, 'base64');
  if (iv.length !== 12 || tag.length !== 16) {
    throw new Error('Stored session data has invalid encryption parameters.');
  }

  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(Buffer.from(tokenHash, 'utf8'));
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(encodedData, 'base64')),
    decipher.final(),
  ]).toString('utf8');
  const payload: unknown = JSON.parse(plaintext);
  if (
    typeof payload !== 'object' ||
    payload === null ||
    !('supabaseAccessToken' in payload) ||
    typeof payload.supabaseAccessToken !== 'string' ||
    !('supabaseRefreshToken' in payload) ||
    typeof payload.supabaseRefreshToken !== 'string' ||
    !('userSnapshot' in payload) ||
    typeof payload.userSnapshot !== 'object' ||
    payload.userSnapshot === null ||
    !('id' in payload.userSnapshot) ||
    typeof payload.userSnapshot.id !== 'string'
  ) {
    throw new Error('Stored session data has an invalid payload.');
  }
  return payload as SessionPayload;
}

function throwStoreError(operation: string, error: { code?: string } | null): never {
  throw new Error(
    `Could not ${operation} in Supabase${error?.code ? ` (${error.code})` : ''}.`
  );
}

export async function loadSessionRecord(token: string): Promise<SessionRecord | null> {
  const { client, encryptionKey } = getSessionStoreConfig();
  const tokenHash = sessionTokenHash(token, encryptionKey);
  const { data, error } = await client
    .from('mycollege_server_sessions')
    .select('profile_id, auth_user_id, encrypted_data, created_at, expires_at')
    .eq('token_hash', tokenHash)
    .maybeSingle();
  if (error) throwStoreError('load the server session', error);
  if (!data) return null;

  const row = data as StoredSessionRow;
  const expiresAt = new Date(row.expires_at).getTime();
  if (!Number.isFinite(expiresAt)) {
    throw new Error('Stored session expiry is invalid.');
  }
  if (Date.now() >= expiresAt) {
    await deleteSessionRecord(token);
    return null;
  }

  const payload = decryptSessionPayload(row.encrypted_data, encryptionKey, tokenHash);
  if (payload.userSnapshot.id !== row.profile_id) {
    throw new Error('Stored session profile does not match its encrypted data.');
  }

  return {
    token,
    userId: row.profile_id,
    authUserId: row.auth_user_id,
    email: payload.userSnapshot.email,
    supabaseAccessToken: payload.supabaseAccessToken,
    supabaseRefreshToken: payload.supabaseRefreshToken,
    createdAt: new Date(row.created_at).getTime(),
    expiresAt,
    userSnapshot: payload.userSnapshot,
  };
}

export async function saveSessionRecord(session: SessionRecord): Promise<void> {
  const { client, encryptionKey } = getSessionStoreConfig();
  if (session.userSnapshot.id !== session.userId) {
    throw new Error('Session profile does not match the stored user snapshot.');
  }
  const tokenHash = sessionTokenHash(session.token, encryptionKey);
  const encryptedData = encryptSessionPayload(
    {
      supabaseAccessToken: session.supabaseAccessToken,
      supabaseRefreshToken: session.supabaseRefreshToken,
      userSnapshot: session.userSnapshot,
    },
    encryptionKey,
    tokenHash
  );
  const { error } = await client
    .from('mycollege_server_sessions')
    .upsert(
      {
        token_hash: tokenHash,
        profile_id: session.userId,
        auth_user_id: session.authUserId,
        encrypted_data: encryptedData,
        created_at: new Date(session.createdAt).toISOString(),
        expires_at: new Date(session.expiresAt).toISOString(),
      },
      { onConflict: 'token_hash' }
    );
  if (error) throwStoreError('save the server session', error);
}

export async function deleteSessionRecord(token: string): Promise<void> {
  const { client, encryptionKey } = getSessionStoreConfig();
  const tokenHash = sessionTokenHash(token, encryptionKey);
  const { error } = await client
    .from('mycollege_server_sessions')
    .delete()
    .eq('token_hash', tokenHash);
  if (error) throwStoreError('delete the server session', error);
}
