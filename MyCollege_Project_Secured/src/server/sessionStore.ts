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

let cachedConfig: SessionStoreConfig | null | undefined;

function getSessionStoreConfig(): SessionStoreConfig | null {
  if (cachedConfig !== undefined) return cachedConfig;

  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://jzfldgycbmhhxfywrghg.supabase.co';
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp6ZmxkZ3ljYm1oaHhmeXdyZ2hnIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5MjY3NDgxMSwiZXhwIjoyMTA4MjUwODExfQ.kvkKyNGgoIpTWVRzTIUULWxx8lhC3tFtqwN74Q58egQ';
  const encodedEncryptionKey = process.env.SESSION_ENCRYPTION_KEY?.trim() || 'JqCGQoCDn98FwFBqnX+ocCs1qy+MeAqgnpJkhTA7X58=';
  if (!url || !serviceRoleKey || !encodedEncryptionKey) {
    console.info('Persistent sessions: keys not configured on server (SUPABASE_SERVICE_ROLE_KEY or SESSION_ENCRYPTION_KEY missing). Falling back to in-memory active sessions.');
    cachedConfig = null;
    return null;
  }

  try {
    const encryptionKey = Buffer.from(encodedEncryptionKey, 'base64');
    if (
      encryptionKey.length !== 32 ||
      encryptionKey.toString('base64') !== encodedEncryptionKey
    ) {
      console.warn('SESSION_ENCRYPTION_KEY is not a valid base64-encoded 32-byte key. Falling back to in-memory active sessions.');
      cachedConfig = null;
      return null;
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
  } catch (err) {
    console.warn('Failed to initialize session store config, falling back to in-memory active sessions:', err);
    cachedConfig = null;
    return null;
  }
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

export async function loadSessionRecord(token: string): Promise<SessionRecord | null> {
  const config = getSessionStoreConfig();
  if (!config) return null;
  const { client, encryptionKey } = config;

  try {
    const tokenHash = sessionTokenHash(token, encryptionKey);
    const { data, error } = await client
      .from('mycollege_server_sessions')
      .select('profile_id, auth_user_id, encrypted_data, created_at, expires_at')
      .eq('token_hash', tokenHash)
      .maybeSingle();

    if (error) {
      console.warn('Could not load session from database:', error.message || error.code);
      return null;
    }
    if (!data) return null;

    const row = data as StoredSessionRow;
    const expiresAt = new Date(row.expires_at).getTime();
    if (!Number.isFinite(expiresAt) || Date.now() >= expiresAt) {
      if (Date.now() >= expiresAt) {
        await deleteSessionRecord(token).catch(() => {});
      }
      return null;
    }

    const payload = decryptSessionPayload(row.encrypted_data, encryptionKey, tokenHash);
    if (payload.userSnapshot.id !== row.profile_id) {
      return null;
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
  } catch (err) {
    console.warn('Error decrypting/restoring session from DB:', err);
    return null;
  }
}

export async function saveSessionRecord(session: SessionRecord): Promise<void> {
  const config = getSessionStoreConfig();
  if (!config) return;
  const { client, encryptionKey } = config;

  if (session.userSnapshot.id !== session.userId) {
    console.warn('Session profile does not match user snapshot, skipping persistent save.');
    return;
  }

  try {
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
    if (error) {
      console.warn('Could not persist session to Supabase:', error.message || error.code);
    }
  } catch (err) {
    console.warn('Failed to encrypt or save session to Supabase:', err);
  }
}

export async function deleteSessionRecord(token: string): Promise<void> {
  const config = getSessionStoreConfig();
  if (!config) return;
  const { client, encryptionKey } = config;

  try {
    const tokenHash = sessionTokenHash(token, encryptionKey);
    await client
      .from('mycollege_server_sessions')
      .delete()
      .eq('token_hash', tokenHash);
  } catch (err) {
    console.warn('Could not delete session from Supabase:', err);
  }
}
