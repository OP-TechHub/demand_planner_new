'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import type { CostAssumptionVersion } from '@oceanpick/shared';

/** Numeric assumption fields an admin may edit on a version. */
const NUMERIC_FIELDS = [
  'feed_cost_per_kg',
  'clearing_cost_per_kg',
  'fcr_reference',
  'fx_rate',
  'import_tax_pct_domestic',
  'import_tax_pct_export',
  'domestic_transport_lkr',
  'domestic_cold_hold_lkr',
  'export_freight_to_port_usd',
  'export_cold_chain_usd',
  'rack_margin_pct',
  'fob_margin_pct',
  'importer_clearing_pct',
  'importer_markup_pct',
  'distributor_markup_pct',
  'container_fill_kg',
  'air_lot_kg',
] as const;

export type SaveState = { error: string | null; ok: boolean };

/**
 * Is the caller an admin?
 *
 * RLS already refuses a non-admin write, so this is about the message rather
 * than the permission: without it the user gets a raw policy-violation string
 * from Postgres, which reads like a bug in the app rather than a rule.
 */
async function requireAdmin(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string
): Promise<string | null> {
  const { data } = await supabase.from('users').select('role').eq('id', userId).maybeSingle();
  return (data as { role: string } | null)?.role === 'admin'
    ? null
    : 'Only an admin can change the company assumptions. Override them inside your own costing instead.';
}

/**
 * Create a NEW version from the current one, with edits applied.
 *
 * Deliberately never an in-place update: saved costings pin a version, so
 * editing one under them would silently rewrite history and break the promise
 * that reopening a costing shows what was quoted (Decisions §4). Changing an
 * assumption mints a new version and makes it current; older versions stay
 * readable forever.
 */
export async function publishAssumptionVersion(_prev: SaveState, fd: FormData): Promise<SaveState> {
  const fromId = String(fd.get('from_version_id') ?? '').trim();
  const label = String(fd.get('label') ?? '').trim();
  const notes = String(fd.get('notes') ?? '').trim();
  if (!fromId) return { error: 'Missing the version to base this on.', ok: false };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'Your session expired. Sign in again.', ok: false };

  const { data: base } = await supabase
    .from('cost_assumption_versions')
    .select('*')
    .eq('id', fromId)
    .maybeSingle();
  if (!base) return { error: 'That assumptions version no longer exists.', ok: false };
  const from = base as CostAssumptionVersion;

  const denied = await requireAdmin(supabase, user.id);
  if (denied) return { error: denied, ok: false };

  const next: Record<string, unknown> = {};
  for (const field of NUMERIC_FIELDS) {
    const raw = fd.get(field);
    if (raw == null) {
      next[field] = from[field];
      continue;
    }
    const value = Number(String(raw).trim());
    if (!Number.isFinite(value) || value < 0) {
      return { error: `${field.replace(/_/g, ' ')} must be a number of 0 or more.`, ok: false };
    }
    next[field] = value;
  }

  // Margins are gross-margin based: price = cost / (1 - margin), so 100% is a
  // division by zero, not an aggressive markup.
  for (const m of ['rack_margin_pct', 'fob_margin_pct'] as const) {
    if ((next[m] as number) >= 1) {
      return { error: 'Rack and FOB margins must be below 100% — price is cost ÷ (1 − margin).', ok: false };
    }
  }
  if ((next.fcr_reference as number) <= 0) return { error: 'FCR must be greater than 0.', ok: false };
  if ((next.fx_rate as number) <= 0) return { error: 'FX rate must be greater than 0.', ok: false };
  if ((next.container_fill_kg as number) <= 0 || (next.air_lot_kg as number) <= 0) {
    return { error: 'Container fill and air lot weights must be greater than 0.', ok: false };
  }

  const { data: latest } = await supabase
    .from('cost_assumption_versions')
    .select('version_no')
    .eq('org_id', from.org_id)
    .order('version_no', { ascending: false })
    .limit(1)
    .maybeSingle();
  const versionNo = ((latest as { version_no: number } | null)?.version_no ?? 0) + 1;

  // Which version is current right now — not necessarily the one being edited,
  // since you can publish from an older one. Remembered so a failure part-way
  // through can put it back.
  const { data: prevCurrentRow } = await supabase
    .from('cost_assumption_versions')
    .select('id')
    .eq('org_id', from.org_id)
    .eq('is_current', true)
    .maybeSingle();
  const prevCurrentId = (prevCurrentRow as { id: string } | null)?.id ?? null;

  /**
   * Undo a half-finished publish.
   *
   * This matters more than it looks. A version whose ODC components failed to
   * copy is not a version with a missing screen — odcTotalUsd sums an empty
   * list to zero, so every SKU's whole-fish cost silently drops by the whole of
   * its other direct costs, and the grid shows cheaper numbers with no error
   * anywhere. Leaving that as the org's current assumptions is far worse than
   * refusing the publish.
   */
  const rollback = async (message: string): Promise<SaveState> => {
    if (newVersionId) await supabase.from('cost_assumption_versions').delete().eq('id', newVersionId);
    if (prevCurrentId) {
      await supabase
        .from('cost_assumption_versions')
        .update({ is_current: true, updated_by: user.id })
        .eq('id', prevCurrentId);
    }
    return { error: message, ok: false };
  };

  // Set once the insert below succeeds, so rollback knows whether there is a
  // version to remove.
  let newVersionId: string | null = null;

  // Clear the current flag first: a partial unique index allows only one.
  const { error: clearError } = await supabase
    .from('cost_assumption_versions')
    .update({ is_current: false, updated_by: user.id })
    .eq('org_id', from.org_id)
    .eq('is_current', true);
  if (clearError) return rollback(clearError.message);

  const { data: created, error } = await supabase
    .from('cost_assumption_versions')
    .insert({
      ...next,
      org_id: from.org_id,
      version_no: versionNo,
      label: label || `v${versionNo}`,
      notes,
      is_current: true,
      created_by: user.id,
      updated_by: user.id,
    })
    .select('id')
    .single();
  if (error || !created) return rollback(error?.message ?? 'Could not save.');
  const newId = (created as { id: string }).id;
  newVersionId = newId;

  // Carry ODC components and destination rates forward, then apply their edits.
  const [{ data: odc }, { data: rates }] = await Promise.all([
    supabase.from('cost_odc_components').select('*').eq('version_id', fromId),
    supabase.from('cost_destination_rates').select('*').eq('version_id', fromId),
  ]);

  const odcRows = (odc ?? []) as { id: string; name: string; value: number; currency: string; basis: string; sort_order: number }[];
  if (odcRows.length) {
    const { error: odcError } = await supabase.from('cost_odc_components').insert(
      odcRows.map((c) => {
        const raw = fd.get(`odc_${c.id}`);
        const edited = raw == null ? c.value : Number(String(raw).trim());
        const basisRaw = fd.get(`odc_basis_${c.id}`);
        return {
          version_id: newId,
          name: c.name,
          value: Number.isFinite(edited) && edited >= 0 ? edited : c.value,
          currency: c.currency,
          basis: basisRaw ? String(basisRaw) : c.basis,
          sort_order: c.sort_order,
        };
      })
    );
    if (odcError) return rollback(`copying the other direct costs: ${odcError.message}`);
  }

  const rateRows = (rates ?? []) as { destination_id: string; sea_rate_per_20ft: number; air_rate_per_lot: number }[];
  if (rateRows.length) {
    const { error: rateError } = await supabase.from('cost_destination_rates').insert(
      rateRows.map((r) => {
        const sea = Number(String(fd.get(`sea_${r.destination_id}`) ?? r.sea_rate_per_20ft).trim());
        const air = Number(String(fd.get(`air_${r.destination_id}`) ?? r.air_rate_per_lot).trim());
        return {
          version_id: newId,
          destination_id: r.destination_id,
          sea_rate_per_20ft: Number.isFinite(sea) && sea >= 0 ? sea : r.sea_rate_per_20ft,
          air_rate_per_lot: Number.isFinite(air) && air >= 0 ? air : r.air_rate_per_lot,
        };
      })
    );
    if (rateError) return rollback(`copying the freight rates: ${rateError.message}`);
  }

  revalidatePath('/costing');
  revalidatePath('/costing/assumptions');
  return { error: null, ok: true };
}

/** Make an older version current again — an undo for a bad publish. */
export async function makeVersionCurrent(id: string): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'Your session expired.' };

  const denied = await requireAdmin(supabase, user.id);
  if (denied) return { error: denied };

  const { data: v } = await supabase
    .from('cost_assumption_versions')
    .select('org_id')
    .eq('id', id)
    .maybeSingle();
  if (!v) return { error: 'No such version.' };

  const orgId = (v as { org_id: string }).org_id;
  const { error: clearError } = await supabase
    .from('cost_assumption_versions')
    .update({ is_current: false, updated_by: user.id })
    .eq('org_id', orgId)
    .eq('is_current', true);
  if (clearError) return { error: clearError.message };

  const { error } = await supabase
    .from('cost_assumption_versions')
    .update({ is_current: true, updated_by: user.id })
    .eq('id', id);
  // Nothing is current now. loadCostingContext falls back to the highest
  // version number so the app keeps working, but say so rather than reporting
  // a bare database error for a state the user cannot see.
  if (error) return { error: `${error.message} — no version is marked current; set one before costing.` };

  revalidatePath('/costing');
  revalidatePath('/costing/assumptions');
  return { error: null };
}

/** Update a size grade's median weight or FCR (Decisions §6 — placeholders). */
export async function saveSizeBucket(
  id: string,
  patch: { median_g?: number; fcr?: number }
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'Your session expired.' };
  const denied = await requireAdmin(supabase, user.id);
  if (denied) return { error: denied };

  const clean: Record<string, number> = {};
  if (patch.median_g != null) {
    if (!Number.isFinite(patch.median_g) || patch.median_g <= 0) return { error: 'Median weight must be above 0.' };
    clean.median_g = Math.round(patch.median_g);
  }
  if (patch.fcr != null) {
    if (!Number.isFinite(patch.fcr) || patch.fcr <= 0) return { error: 'FCR must be above 0.' };
    clean.fcr = patch.fcr;
  }
  if (Object.keys(clean).length === 0) return { error: null };

  const { error } = await supabase.from('cost_size_buckets').update(clean).eq('id', id);
  if (error) return { error: error.message };
  revalidatePath('/costing/assumptions');
  revalidatePath('/costing');
  return { error: null };
}
