'use server';

import { headers } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { sendEmails } from '@/lib/email';
import { renderResetEmail } from '@/lib/reset-password-email';

export type ForgotState = { error: string | null; sent: boolean };

/**
 * Send a password-reset email. The link lands on our /auth/callback, which
 * establishes a short-lived recovery session and forwards to /reset-password to
 * choose a new password.
 *
 * Delivery goes through **Resend**, not Supabase's mailer: this Supabase
 * project's SMTP settings are shared with another app, so we mint the recovery
 * token ourselves with `admin.generateLink` (which sends nothing) and mail it
 * from here. Without RESEND_API_KEY we fall back to Supabase's own sender.
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
  const callback = `${origin}/auth/callback?next=/reset-password`;

  // No Resend key (local dev, or the key was pulled) — let Supabase mail it, so
  // the flow still works rather than going silently dead.
  if (!process.env.RESEND_API_KEY) {
    const supabase = await createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: callback });
    if (error) {
      console.error('resetPasswordForEmail:', error.status, error.message);
      if (error.status === 429) return { error: 'Too many attempts — wait a few minutes and try again.', sent: false };
    }
    return { error: null, sent: true };
  }

  // Mint the recovery token WITHOUT sending: generateLink never mails, so the
  // Supabase SMTP shared with the other app is untouched. An error here is
  // almost always "no such user", which we must not reveal.
  const svc = createServiceClient();
  const { data, error } = await svc.auth.admin.generateLink({
    type: 'recovery',
    email,
    options: { redirectTo: callback },
  });
  const tokenHash = data?.properties?.hashed_token;
  if (error || !tokenHash) {
    console.error('generateLink(recovery):', error?.status, error?.message);
    return { error: null, sent: true };
  }

  // Point at OUR callback in the `token_hash` + `type` shape it already handles.
  // (Not data.action_link — that detours through Supabase's /auth/v1/verify.)
  const link = `${callback}&token_hash=${encodeURIComponent(tokenHash)}&type=recovery`;
  const { subject, html, text } = renderResetEmail(link);
  const res = await sendEmails([{ to: email, subject, html, text }]);
  // Still report "sent" on a delivery failure — surfacing it would leak that the
  // address exists. The log is where you look when someone says it never came.
  if (!res.ok) console.error('reset email send failed:', res.error);

  return { error: null, sent: true };
}
