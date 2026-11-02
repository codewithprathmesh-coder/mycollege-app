import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const supabaseConfig = (() => {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key =
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key) {
    throw new Error(
      'Missing SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY (or their VITE_ equivalents) in .env'
    );
  }

  return { url, key };
})();

export const supabaseAuth = createClient(
  supabaseConfig.url,
  supabaseConfig.key,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  }
);

export function createSupabaseAdminClient() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!serviceRoleKey) return null;

  return createClient(supabaseConfig.url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

export function createAuthenticatedSupabaseClient(accessToken: string) {
  return createClient(supabaseConfig.url, supabaseConfig.key, {
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
