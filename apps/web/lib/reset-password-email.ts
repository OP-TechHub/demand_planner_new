/**
 * The branded password-reset email.
 *
 * Supabase Auth's own mailer is deliberately NOT used for this: the project's
 * SMTP settings are shared with another app on the same Supabase project, so
 * repointing them would change that app's mail too. Instead the recovery link is
 * generated server-side (service role, no email sent) and delivered through
 * Resend — the same sender `lib/email.ts` uses for harvest-change notifications.
 */

/**
 * What the email TELLS the user. The real expiry is Supabase's own setting
 * (Authentication → Sessions → "Email OTP Expiration", 1 hour by default) —
 * if you change it there, change this label to match.
 */
const LINK_TTL_LABEL = 'one hour';

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch] as string));
}

export function renderResetEmail(link: string): { subject: string; html: string; text: string } {
  const href = esc(link);
  return {
    subject: 'Reset your Oceanpick Demand Planner password',
    html: `<!doctype html><html><body style="margin:0;background:#f8fafc;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
    <div style="max-width:640px;margin:0 auto;padding:24px;">
      <div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
        <div style="padding:20px 24px;background:linear-gradient(135deg,#1e6fd9,#0ea5b7);color:#ffffff;">
          <div style="font-size:12px;letter-spacing:.06em;text-transform:uppercase;opacity:.85;">Oceanpick Demand Planner</div>
          <div style="font-size:18px;font-weight:700;margin-top:4px;">Reset your password</div>
        </div>
        <div style="padding:20px 24px;">
          <p style="margin:0 0 16px;font-size:14px;color:#334155;">
            Someone asked to reset the password for this account. Choose a new one with the button below.
          </p>
          <a href="${href}" style="display:inline-block;padding:9px 16px;border-radius:8px;background:#1e6fd9;color:#ffffff;text-decoration:none;font-size:13px;font-weight:600;">Choose a new password</a>
          <p style="margin:16px 0 0;font-size:12px;color:#64748b;">
            This link works once and expires in ${LINK_TTL_LABEL}. If you didn't ask for it, ignore this email — your password stays as it is.
          </p>
          <p style="margin:12px 0 0;font-size:11px;color:#94a3b8;word-break:break-all;">
            Button not working? Paste this into your browser:<br>${href}
          </p>
        </div>
      </div>
    </div>
  </body></html>`,
    text: [
      'Reset your Oceanpick Demand Planner password',
      '',
      'Someone asked to reset the password for this account. Open the link below to choose a new one:',
      '',
      link,
      '',
      `This link works once and expires in ${LINK_TTL_LABEL}.`,
      "If you didn't ask for it, ignore this email — your password stays as it is.",
    ].join('\n'),
  };
}
