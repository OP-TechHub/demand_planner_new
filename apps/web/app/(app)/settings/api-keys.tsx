'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { KeyRound, Copy, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { confirmDialog } from '@/components/ui/confirm';
import { createApiKey, revokeApiKey, type ApiKeyRow, type CreateKeyState } from './api-keys-actions';

const initial: CreateKeyState = { error: null, secret: null, label: null };

/**
 * Admin card to mint and revoke API keys for the read API (/api/v1). A freshly
 * minted key's secret is shown exactly once — we only ever store its hash.
 */
export function ApiKeysCard({ keys }: { keys: ApiKeyRow[] }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(createApiKey, initial);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.secret) {
      formRef.current?.reset();
      router.refresh();
    }
  }, [state.secret, router]);

  return (
    <div className="mx-auto max-w-2xl space-y-4 rounded-lg border bg-card p-5 text-sm">
      <div className="flex items-center gap-2">
        <KeyRound className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-base font-semibold">API keys</h2>
      </div>
      <p className="text-muted-foreground">
        For another system (e.g. the PO matching app) to read this plan through <code className="rounded bg-muted px-1">/api/v1</code>.
        Each key is read-only and scoped to your organisation. The secret is shown once — store it safely, and revoke here if it leaks.
      </p>

      {state.secret && (
        <NewKeyReveal secret={state.secret} label={state.label ?? ''} />
      )}

      <form ref={formRef} action={formAction} className="flex items-end gap-2">
        <label className="flex-1">
          <span className="mb-1 block text-xs font-medium text-muted-foreground">New key label</span>
          <Input name="label" placeholder="e.g. PO matching app" maxLength={80} required />
        </label>
        <Button type="submit" disabled={pending}>{pending ? 'Creating…' : 'Create key'}</Button>
      </form>
      {state.error && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-destructive">{state.error}</p>}

      {keys.length > 0 && (
        <ul className="divide-y rounded-md border">
          {keys.map((k) => (
            <li key={k.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <div className="min-w-0">
                <div className="truncate font-medium">{k.label}</div>
                <div className="text-xs text-muted-foreground">
                  <code>{k.key_prefix}…</code> · created {fmtDate(k.created_at)} ·{' '}
                  {k.last_used_at ? `last used ${fmtDate(k.last_used_at)}` : 'never used'}
                </div>
              </div>
              <form
                action={async (fd) => {
                  const ok = await confirmDialog({
                    title: `Revoke “${k.label}”?`,
                    description: 'Any system using this key stops working immediately. This cannot be undone.',
                    confirmLabel: 'Revoke',
                    destructive: true,
                  });
                  if (ok) { await revokeApiKey(fd); toast.success('Key revoked.'); router.refresh(); }
                }}
              >
                <input type="hidden" name="id" value={k.id} />
                <Button type="submit" variant="outline" size="sm">Revoke</Button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function NewKeyReveal({ secret, label }: { secret: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-2 rounded-md border border-success/30 bg-success/10 p-3">
      <p className="text-xs font-medium text-success">
        Key created{label ? ` for “${label}”` : ''}. Copy it now — you won’t see it again.
      </p>
      <div className="flex items-center gap-2">
        <code className="flex-1 truncate rounded bg-card px-2 py-1.5 text-xs">{secret}</code>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(secret);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            } catch {
              toast.error('Could not copy — select and copy manually.');
            }
          }}
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
    </div>
  );
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
