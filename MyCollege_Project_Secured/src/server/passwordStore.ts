import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createSupabaseAdminClient, supabaseAuth } from '../../supabaseAuthClient.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface PasswordRecord {
  email: string;
  profileId?: string;
  passwordHash: string; // "salt:hash"
  updatedAt: string;
}

// In-memory cache for fast, zero-delay lookups
const passwordCache = new Map<string, PasswordRecord>();

// Local persistent file fallback (ensures passwords survive restarts even without database migrations)
const DATA_DIR = path.resolve(__dirname, '../../../.server_data');
const PASSWORDS_FILE = path.join(DATA_DIR, 'user_passwords.json');

function ensureDataDir(): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
  } catch (err) {
    console.warn('[AUTH] Could not create local .server_data directory:', err);
  }
}

function loadLocalPasswords(): void {
  try {
    ensureDataDir();
    if (fs.existsSync(PASSWORDS_FILE)) {
      const content = fs.readFileSync(PASSWORDS_FILE, 'utf8');
      const data: Record<string, PasswordRecord> = JSON.parse(content);
      for (const [email, record] of Object.entries(data)) {
        passwordCache.set(email.toLowerCase(), record);
      }
      console.info(`[AUTH] Loaded ${passwordCache.size} persistent user password records from storage.`);
    }
  } catch (err) {
    console.warn('[AUTH] Could not load local passwords file:', err);
  }
}

function persistLocalPasswords(): void {
  try {
    ensureDataDir();
    const data: Record<string, PasswordRecord> = {};
    for (const [email, record] of passwordCache.entries()) {
      data[email] = record;
    }
    fs.writeFileSync(PASSWORDS_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.warn('[AUTH] Could not persist local passwords file:', err);
  }
}

// Initial load on import
loadLocalPasswords();

export function hashPassword(plainText: string): string {
  const salt = randomBytes(16).toString('hex');
  const derivedKey = scryptSync(plainText, salt, 64).toString('hex');
  return `${salt}:${derivedKey}`;
}

export function verifyPassword(plainText: string, storedHash: string): boolean {
  try {
    const parts = storedHash.split(':');
    if (parts.length !== 2) return false;
    const [salt, expectedHash] = parts;
    const actualKey = scryptSync(plainText, salt, 64);
    const expectedKey = Buffer.from(expectedHash, 'hex');
    if (actualKey.length !== expectedKey.length) return false;
    return timingSafeEqual(actualKey, expectedKey);
  } catch {
    return false;
  }
}

/**
 * Check if a user has configured a password
 */
export async function hasUserPassword(email: string): Promise<boolean> {
  const norm = email.trim().toLowerCase();
  if (passwordCache.has(norm)) {
    return true;
  }

  // Check Supabase table
  try {
    const supabaseAdmin = createSupabaseAdminClient();
    const client = supabaseAdmin || supabaseAuth;
    const { data } = await client
      .from('mycollege_user_passwords')
      .select('email, password_hash, profile_id, updated_at')
      .eq('email', norm)
      .maybeSingle();

    if (data?.password_hash) {
      passwordCache.set(norm, {
        email: norm,
        profileId: data.profile_id || undefined,
        passwordHash: data.password_hash,
        updatedAt: data.updated_at || new Date().toISOString(),
      });
      persistLocalPasswords();
      return true;
    }
  } catch {
    // If Supabase table doesn't exist yet, fallback to cache
  }

  return false;
}

/**
 * Save or update user password
 */
export async function saveUserPassword(
  email: string,
  plainPassword: string,
  profileId?: string
): Promise<boolean> {
  const norm = email.trim().toLowerCase();
  const passwordHash = hashPassword(plainPassword);
  const updatedAt = new Date().toISOString();

  const record: PasswordRecord = {
    email: norm,
    profileId,
    passwordHash,
    updatedAt,
  };

  // 1. Update in-memory cache and local file
  passwordCache.set(norm, record);
  persistLocalPasswords();

  // 2. Persist to Supabase database table
  try {
    const supabaseAdmin = createSupabaseAdminClient();
    const client = supabaseAdmin || supabaseAuth;
    await client
      .from('mycollege_user_passwords')
      .upsert({
        email: norm,
        profile_id: profileId || null,
        password_hash: passwordHash,
        updated_at: updatedAt,
      }, { onConflict: 'email' });
  } catch (dbErr) {
    console.warn('[AUTH] Note: Could not sync password to Supabase table (local secure storage used):', dbErr);
  }

  // 3. Sync to Supabase Auth admin so signInWithPassword also works
  if (profileId) {
    try {
      const supabaseAdmin = createSupabaseAdminClient();
      if (supabaseAdmin) {
        await supabaseAdmin.auth.admin.updateUserById(profileId, {
          password: plainPassword,
        });
      }
    } catch (authErr) {
      console.warn('[AUTH] Could not update password in Supabase Auth admin:', authErr);
    }
  }

  return true;
}

/**
 * Validate password for a given user email
 */
export async function checkUserPassword(
  email: string,
  plainPassword: string
): Promise<{ valid: boolean; profileId?: string }> {
  const norm = email.trim().toLowerCase();

  // 1. Check local / cached password first
  let record = passwordCache.get(norm);

  if (!record) {
    // Check Supabase table
    try {
      const supabaseAdmin = createSupabaseAdminClient();
      const client = supabaseAdmin || supabaseAuth;
      const { data } = await client
        .from('mycollege_user_passwords')
        .select('email, password_hash, profile_id, updated_at')
        .eq('email', norm)
        .maybeSingle();

      if (data?.password_hash) {
        record = {
          email: norm,
          profileId: data.profile_id || undefined,
          passwordHash: data.password_hash,
          updatedAt: data.updated_at || new Date().toISOString(),
        };
        passwordCache.set(norm, record);
        persistLocalPasswords();
      }
    } catch {
      // Ignored
    }
  }

  if (record) {
    const isValid = verifyPassword(plainPassword, record.passwordHash);
    if (isValid) {
      return { valid: true, profileId: record.profileId };
    }
    return { valid: false };
  }

  // 2. Fallback: Check if Supabase Auth accepts this password directly
  try {
    const { data, error } = await supabaseAuth.auth.signInWithPassword({
      email: norm,
      password: plainPassword,
    });
    if (!error && data?.user) {
      // Automatically cache for next time
      void saveUserPassword(norm, plainPassword, data.user.id);
      return { valid: true, profileId: data.user.id };
    }
  } catch {
    // Fall through
  }

  return { valid: false };
}

