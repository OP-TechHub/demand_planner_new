'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { generateApiKey } from '@/lib/api-keys';

export type ApiKeyRow = {
  id: string;
  label: string;
  key_prefix: string;
  created_at: string;
  last_used_at: string | null;
};

/** The org's live (non-revoked) API keys, newest first. Admin-only via RLS. */
export async function listApiKeys(): Promise<ApiKeyRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('api_keys')
    .select('id, label, key_prefix, created_at, last_used_at')
    .is('revoked_at', null)
    .order('created_at', { ascending: false });
  return (data ?? []) as ApiKeyRow[];
}

export type CreateKeyState = { error: string | null; secret: string | null; label: string | null };

/**
 * Mint a new key. Returns the raw secret ONCE — it's only stored hashed, so it
 * can't be shown again. RLS enforces admin; we still resolve the caller's org
 * to satisfy the NOT NULL column.
 */
export async function createApiKey(_prev: CreateKeyState, fd: FormData): Promise<CreateKeyState> {
  const label = String(fd.get('label') ?? '').trim();
  if (!label) return { error: 'Give the key a label so you can tell it apart later.', secret: null, label: null };
  if (label.length > 80) return { error: 'Label is too long (80 characters max).', secret: null, label: null };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Your session expired. Sign in again.', secret: null, label: null };

  const { data: me } = await supabase.from('users').select('org_id').eq('id', user.id).maybeSingle();
  if (!me?.org_id) return { error: 'Could not resolve your organisation.', secret: null, label: null };

  const { raw, hash, keyPrefix } = generateApiKey();
  const { error } = await supabase
    .from('api_keys')
    .insert({ org_id: me.org_id, label, key_hash: hash, key_prefix: keyPrefix, created_by: user.id });

  if (error) {
    const msg = /row-level security|violates row-level/i.test(error.message)
      ? 'Only an admin can create API keys.'
      : error.message;
    return { error: msg, secret: null, label: null };
  }

  revalidatePath('/settings');
  return { error: null, secret: raw, label };
}

/** Revoke a key immediately. It stops working on the next request. */
export async function revokeApiKey(fd: FormData): Promise<void> {
  const id = String(fd.get('id') ?? '').trim();
  if (!id) return;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  await supabase.from('api_keys').update({ revoked_at: new Date().toISOString() }).eq('id', id);
  revalidatePath('/settings');
}
