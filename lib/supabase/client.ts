import { createBrowserClient } from '@supabase/ssr';
import type { Database } from '@/types/supabase';

let browserClientInstance: ReturnType<typeof createBrowserClient<Database>> | null = null;

/**
 * Browser singleton Supabase client
 * Prevents multiple GoTrue client instances and redundant socket connections across browser tabs.
 */
export function createClient() {
  if (typeof window === 'undefined') {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-anon-key';
    return createBrowserClient<Database>(supabaseUrl, supabaseAnonKey);
  }

  if (!browserClientInstance) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-anon-key';
    browserClientInstance = createBrowserClient<Database>(supabaseUrl, supabaseAnonKey);
  }

  return browserClientInstance;
}
