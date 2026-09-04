'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

/**
 * Admin recovery for the costing module's two soft-deleted tables.
 *
 * Deleting a costing and archiving a SKU only stamp `deleted_at` — nothing is
 * erased, and the child rows (lines, destinations, yields, marinade recipe) are
 * never touched — so a restore is one UPDATE clearing that column.
 *
 * It has to run under the service role. The read policy on `cost_costings`
 * carries `deleted_at is null`, so the cookie-bound client cannot see a deleted
 * costing at all, let alone update it. The service client bypasses RLS, which
 * makes the `org_id` filter on every statement below the only thing keeping one
 * org out of another's bin — it is not optional, and the admin check above it
 * stands in for the policy that would otherwise gate the write.
 */

interface Caller {
  userId: string;
  orgId: string;
}

async function requireAdmin(): Promise<{ caller: Caller | null; error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { caller: null, error: 'Your session expired.' };

  const { data } = await supabase.from('users').select('role, org_id').eq('id', user.id).maybeSingle();
  const me = data as { role: string; org_id: string } | null;
  if (me?.role !== 'admin') return { caller: null, error: 'Only an admin can restore deleted costings.' };
  return { caller: { userId: user.id, orgId: me.org_id }, error: null };
}

/** Bring a deleted costing back to the Saved costings list. */
export async function restoreCosting(id: string): Promise<{ error: string | null }> {
  const { caller, error: denied } = await requireAdmin();
  if (!caller) return { error: denied };

  const svc = createServiceClient();
  const { data, error } = await svc
    .from('cost_costings')
    .update({ deleted_at: null, updated_by: caller.userId })
    .eq('id', id)
    .eq('org_id', caller.orgId)
    .not('deleted_at', 'is', null)
    .select('id');
  if (error) return { error: error.message };
  // Zero rows means someone else restored it while this page was open.
  if (!data?.length) return { error: 'That costing is no longer in the bin — refresh the page.' };

  revalidatePath('/costing/saved');
  revalidatePath('/costing/archived');
  return { error: null };
}

/** Bring an archived SKU back to the SKU list, and to the costing grid. */
export async function restoreCostSku(id: string): Promise<{ error: string | null }> {
  const { caller, error: denied } = await requireAdmin();
  if (!caller) return { error: denied };

  const svc = createServiceClient();
  const { data, error } = await svc
    .from('cost_skus')
    .update({ deleted_at: null, updated_by: caller.userId })
    .eq('id', id)
    .eq('org_id', caller.orgId)
    .not('deleted_at', 'is', null)
    .select('id');
  if (error) {
    // The SKU name index is unique only over live rows, so a name freed by the
    // archive can be taken by a new SKU in the meantime. Say which fix works —
    // the alternative reading, "the restore is broken", sends the admin to us.
    const m = error.message.toLowerCase();
    if (m.includes('cost_skus_name_unique') || m.includes('duplicate') || m.includes('unique')) {
      return { error: 'A live SKU already uses this name. Rename that one, then restore this.' };
    }
    return { error: error.message };
  }
  if (!data?.length) return { error: 'That SKU is no longer archived — refresh the page.' };

  revalidatePath('/costing/skus');
  revalidatePath('/costing');
  revalidatePath('/costing/archived');
  return { error: null };
}
