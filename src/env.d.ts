/// <reference types="astro/client" />

import type { JwtPayload, SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './lib/database.types';

declare global {
  namespace App {
    interface Locals {
      supabase: SupabaseClient<Database>;
      claims: JwtPayload | null;
    }
  }
}
