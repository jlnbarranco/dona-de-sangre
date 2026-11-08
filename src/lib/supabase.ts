import { createServerClient, parseCookieHeader } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AstroCookies } from 'astro';
import { SUPABASE_KEY, SUPABASE_URL } from 'astro:env/server';
import type { Database } from './database.types';

export function createSupabaseServerClient(
  request: Request,
  cookies: AstroCookies
): SupabaseClient<Database> {
  return createServerClient<Database>(SUPABASE_URL, SUPABASE_KEY, {
    cookies: {
      getAll() {
        return parseCookieHeader(request.headers.get('cookie') ?? '');
      },
      setAll(cookiesToSet) {
        for (const { name, value, options } of cookiesToSet) {
          cookies.set(name, value, {
            ...options,
            path: options.path ?? '/',
            httpOnly: true,
            sameSite: 'lax',
            secure: import.meta.env.PROD
          });
        }
      }
    }
  });
}
