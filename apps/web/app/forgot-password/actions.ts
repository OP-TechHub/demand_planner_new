'use server';

import { headers } from 'next/headers';
import { createClient } from '@/lib/supabase/server';

export type ForgotState = { error: string | null; sent: boolean };

/**
 * Send a password-reset email via Supabase Auth. The link lands on our
 * /auth/callback, which establishes a short-lived recovery session and forwards
 * to /reset-password to choose a new password.
 *
 * We always report "sent" (even for unknown emails) so this can't be used to
 * probe which addresses have accounts.
 */
export async function requestPasswordReset(_prev: ForgotState, formData: FormData): Promise<ForgotState> {
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  if (!email) return { error: 'Enter your email.', sent: false };

  const h = await headers();
  const host = h.get('host') ?? '';
  const proto = h.get('x-forwarded-proto') ?? (host.includes('localhost') ? 'http' : 'https');
  const origin = (process.env.NEXT_PUBLIC_SITE_URL || `${proto}://${host}`).replace(/\/$/, '');

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/auth/callback?next=/reset-password`,
  });
  // Don't leak whether the address exists; only surface a hard rate-limit.
  if (error) {
    console.error('resetPasswordForEmail:', error.status, error.message);
    if (error.status === 429) return { error: 'Too many attempts — wait a few minutes and try again.', sent: false };
  }
  return { error: null, sent: true };
}
