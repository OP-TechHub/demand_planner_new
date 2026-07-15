'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

export type BucketFormState = { error: string | null; ok: boolean };

/** Create or update a bucket (admin only — enforced by RLS). */
export async function saveBucket(_prev: BucketFormState, fd: FormData): Promise<BucketFormState> {
  const id = String(fd.get('id') ?? '').trim();
  const orgId = String(fd.get('org_id') ?? '').trim();
  const name = String(fd.get('name') ?? '').trim();
  const sortRaw = String(fd.get('sort_order') ?? '').trim();
  const sortOrder = Number(sortRaw);

  if (!name) return { error: 'Name is required.', ok: false };
  if (!Number.isInteger(sortOrder)) return { error: 'Order must be a whole number.', ok: false };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Your session expired. Sign in again.', ok: false };

  if (id) {
    const { error } = await supabase
      .from('buckets')
      .update({ name, sort_order: sortOrder, updated_by: user.id })
      .eq('id', id);
    if (error) return { error: friendly(error.message), ok: false };
  } else {
    if (!orgId) return { error: 'Missing organization.', ok: false };
    const { error } = await supabase
      .from('buckets')
      .insert({ org_id: orgId, name, sort_order: sortOrder, created_by: user.id, updated_by: user.id });
    if (error) return { error: friendly(error.message), ok: false };
  }

  revalidatePath('/buckets');
  return { error: null, ok: true };
}

/** Archive or restore a bucket (soft-hide; never hard-delete a bucket in use). */
export async function setBucketArchived(id: string, archived: boolean): Promise<{ error: string | null }> {
  if (!id) return { error: 'Missing bucket.' };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Your session expired.' };
  const { error } = await supabase
    .from('buckets')
    .update({ is_archived: archived, updated_by: user.id })
    .eq('id', id);
  if (error) return { error: error.message };
  revalidatePath('/buckets');
  return { error: null };
}

function friendly(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('duplicate') || m.includes('unique')) {
    return 'A bucket with that name already exists in this organization.';
  }
  return message;
}
