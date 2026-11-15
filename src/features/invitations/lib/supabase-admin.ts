import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_SECRET_API_KEY, SUPABASE_URL } from 'astro:env/server';
import type { Database } from '../../../lib/database.types';

// Cliente admin con clave secreta: solo para rutas de API server-side.
// Prohibido importarlo desde páginas o scripts que se envían al cliente.
export function createSupabaseAdminClient(): SupabaseClient<Database> {
  return createClient<Database>(SUPABASE_URL, SUPABASE_SECRET_API_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
}
