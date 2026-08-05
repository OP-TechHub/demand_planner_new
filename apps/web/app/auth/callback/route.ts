import { NextResponse, type NextRequest } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';

/**
 * Establishes a session from an email link, for confirmation, magic-link, and
 * password-recovery flows. Handles both link shapes Supabase may send:
 *  - PKCE: `?code=…` (same browser that requested it) → exchangeCodeForSession
 *  - OTP:  `?token_hash=…&type=recovery` (works across devices) → verifyOtp
 * On success it forwards to `next` (e.g. /reset-password); otherwise back to login.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type') as EmailOtpType | null;
  const next = searchParams.get('next') ?? '/';

  const supabase = await createClient();

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}${next}`);
  } else if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) return NextResponse.redirect(`${origin}${next}`);
  }

  return NextResponse.redirect(`${origin}/login?error=Could not verify your link`);
}
