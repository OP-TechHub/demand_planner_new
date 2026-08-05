/**
 * Minimal transactional-email sender, backed by Resend's HTTP API (no SDK — a
 * single fetch, so nothing to install and it runs anywhere the recompute route
 * runs). Configure with two env vars:
 *
 *   RESEND_API_KEY  — your Resend API key (required; without it, sends are skipped)
 *   RESEND_FROM     — the From header, e.g. "Oceanpick Planner <planner@oceanpick.com>"
 *                     (must be a verified domain; falls back to Resend's test sender)
 *
 * Sending is best-effort: callers should treat a failure as non-fatal.
 */

export type Mail = { to: string; subject: string; html: string; text?: string };

type SendResult = { ok: boolean; sent: number; skipped?: boolean; error?: string };

const RESEND_BATCH_URL = 'https://api.resend.com/emails/batch';
const BATCH_MAX = 100; // Resend's per-call cap for the batch endpoint

/**
 * Send one personalised email per recipient (so nobody sees anyone else's
 * address). Uses Resend's batch endpoint, up to 100 messages per HTTP call.
 */
export async function sendEmails(mails: Mail[]): Promise<SendResult> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM || 'Oceanpick Demand Planner <onboarding@resend.dev>';
  if (!key) return { ok: false, sent: 0, skipped: true, error: 'RESEND_API_KEY not set — email skipped.' };
  if (!mails.length) return { ok: true, sent: 0, skipped: true };

  let sent = 0;
  for (let i = 0; i < mails.length; i += BATCH_MAX) {
    const chunk = mails.slice(i, i + BATCH_MAX).map((m) => ({
      from, to: [m.to], subject: m.subject, html: m.html, ...(m.text ? { text: m.text } : {}),
    }));
    const res = await fetch(RESEND_BATCH_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(chunk),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { ok: false, sent, error: `Resend ${res.status}: ${body.slice(0, 300)}` };
    }
    sent += chunk.length;
  }
  return { ok: true, sent };
}
