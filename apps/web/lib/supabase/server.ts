import { createServerClient, type SetAllCookies } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { DB_SCHEMA } from '@oceanpick/shared';

type CookiesToSet = Parameters<SetAllCookies>[0];

/**
 * Server-side Supabase client, scoped to the caller's session.
 * Uses the anon key, so every query runs under RLS as that user.
 * This is deliberate: the database enforces access, not the app.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      db: { schema: DB_SCHEMA },
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: CookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from a Server Component, where cookies are read-only.
            // Safe to ignore: middleware refreshes the session on every request.
          }
        },
      },
    }
  );
}
