'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { isBaseCostField } from '@/lib/costing-base-cost';
import {
  canEditAssumptions, canEditBaseCost, type CostAssumptionVersion, type UserRole,
} from '@oceanpick/shared';

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

interface Access {
  isAdmin: boolean;
  /** Admin, or a user an admin has granted 'base_cost_edit'. */
  canEditBase: boolean;
  /** Admin, or a user an admin has granted 'assumptions_edit' — everything else. */
  canEditRest: boolean;
  /** Either grant is enough to mint a version; the two above say which fields move. */
  canPublish: boolean;
  orgId: string | null;
}

/** The caller's role, org and assumption grants, in one query. */
async function getAccess(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string
): Promise<Access> {
  const { data } = await supabase
    .from('users')
    .select('role, org_id, edit_sections')
    .eq('id', userId)
    .maybeSingle();
  const row = data as { role: string; org_id: string; edit_sections: string[] | null } | null;
  const role = (row?.role ?? 'viewer') as UserRole;
  const isAdmin = role === 'admin';
  const canEditBase = canEditBaseCost(role, row?.edit_sections);
  const canEditRest = canEditAssumptions(role, row?.edit_sections);
  return {
    isAdmin,
    canEditBase,
    canEditRest,
    canPublish: isAdmin || canEditBase || canEditRest,
    orgId: row?.org_id ?? null,
  };
}

/**
 * The caller, refused unless some part of the assumptions is theirs to change.
 *
 * RLS reserves these tables for admins, so a grantee's writes go in under the
 * service role and the org has to be checked here rather than by a policy —
 * hence returning the org alongside the verdict.
 */
async function requireAssumptionsEditor(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  orgId: string
): Promise<{ access: Access; error: string | null }> {
  const access = await getAccess(supabase, userId);
  if (!access.canPublish) {
    return {
      access,
      error: 'Only an admin can change the company assumptions. Override them inside your own costing instead.',
    };
  }
  if (!access.isAdmin && access.orgId !== orgId) {
    return { access, error: 'Those assumptions belong to another organisation.' };
  }
  return { access, error: null };
}

/**
 * Create a NEW version from the current one, with edits applied.
 *
 * Deliberately never an in-place update: saved costings pin a version, so
 * editing one under them would silently rewrite history and break the promise
 * that reopening a costing shows what was quoted (Decisions §4). Changing an
 * assumption mints a new version and makes it current; older versions stay
 * readable forever.
 *
 * Three kinds of caller reach this: an admin, who may change anything; a user
 * granted 'base_cost_edit', who may change only the base fish cost and the ODC
 * components; and a user granted 'assumptions_edit', who may change everything
 * BUT those — the adders, margins, weights and freight rates. The two grants
 * are independent and compose: hold both and you can move the whole screen.
 *
 * Whatever a caller may not change is taken from the source version regardless
 * of what the form posted. Their inputs are disabled on screen, but a disabled
 * input is a UI state, not a permission.
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

  const { access, error: denied } = await requireAssumptionsEditor(supabase, user.id, from.org_id);
  if (denied) return { error: denied, ok: false };
  // Admins keep writing as themselves; only the narrower paths need the wider key.
  const db = access.isAdmin ? supabase : createServiceClient();

  /** Whichever half of the screen this field belongs to, may the caller move it? */
  const mayEdit = (field: string) => (isBaseCostField(field) ? access.canEditBase : access.canEditRest);

  const next: Record<string, unknown> = {};
  for (const field of NUMERIC_FIELDS) {
    const raw = fd.get(field);
    // A field outside the caller's grant is carried forward, posted or not.
    if (raw == null || !mayEdit(field)) {
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
    if (newVersionId) await db.from('cost_assumption_versions').delete().eq('id', newVersionId);
    if (prevCurrentId) {
      await db
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
  const { error: clearError } = await db
    .from('cost_assumption_versions')
    .update({ is_current: false, updated_by: user.id })
    .eq('org_id', from.org_id)
    .eq('is_current', true);
  if (clearError) return rollback(clearError.message);

  const { data: created, error } = await db
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
    const { error: odcError } = await db.from('cost_odc_components').insert(
      odcRows.map((c) => {
        // The ODC table belongs to the base-cost half, so an assumptions-only
        // grantee carries it forward untouched. They never see it on screen —
        // it is masked out of their payload entirely — but the check is here
        // rather than resting on that.
        const raw = access.canEditBase ? fd.get(`odc_${c.id}`) : null;
        const edited = raw == null ? c.value : Number(String(raw).trim());
        const basisRaw = access.canEditBase ? fd.get(`odc_basis_${c.id}`) : null;
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
    const { error: rateError } = await db.from('cost_destination_rates').insert(
      rateRows.map((r) => {
        // Freight rates sit in the non-base-cost half of the screen.
        const posted = (key: string, fallback: number) =>
          access.canEditRest ? (fd.get(key) ?? fallback) : fallback;
        const sea = Number(String(posted(`sea_${r.destination_id}`, r.sea_rate_per_20ft)).trim());
        const air = Number(String(posted(`air_${r.destination_id}`, r.air_rate_per_lot)).trim());
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

/**
 * Make an older version current again — an undo for a bad publish.
 *
 * Open to anyone who may publish, not admins only: publishing already decides
 * which version is current, so withholding the undo would leave a grantee able
 * to make the mistake and unable to fix it.
 */
export async function makeVersionCurrent(id: string): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'Your session expired.' };

  const { data: v } = await supabase
    .from('cost_assumption_versions')
    .select('org_id')
    .eq('id', id)
    .maybeSingle();
  if (!v) return { error: 'No such version.' };

  const orgId = (v as { org_id: string }).org_id;
  const { access, error: denied } = await requireAssumptionsEditor(supabase, user.id, orgId);
  if (denied) return { error: denied };
  const db = access.isAdmin ? supabase : createServiceClient();

  const { error: clearError } = await db
    .from('cost_assumption_versions')
    .update({ is_current: false, updated_by: user.id })
    .eq('org_id', orgId)
    .eq('is_current', true);
  if (clearError) return { error: clearError.message };

  const { error } = await db
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

/**
 * Update a size grade's median weight or FCR (Decisions §6 — placeholders).
 *
 * Part of the non-base-cost half of the screen, so an 'assumptions_edit'
 * grantee maintains these too. Unlike the version fields these are edited in
 * place rather than versioned — a size grade is a description of the fish, not
 * a number a costing was quoted on.
 */
export async function saveSizeBucket(
  id: string,
  patch: { median_g?: number; fcr?: number }
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'Your session expired.' };

  const { data: b } = await supabase
    .from('cost_size_buckets')
    .select('org_id')
    .eq('id', id)
    .maybeSingle();
  if (!b) return { error: 'No such size grade.' };
  const access = await getAccess(supabase, user.id);
  if (!access.canEditRest) {
    return { error: 'You don’t have access to change the size grades — ask an admin.' };
  }
  if (!access.isAdmin && access.orgId !== (b as { org_id: string }).org_id) {
    return { error: 'That size grade belongs to another organisation.' };
  }
  const db = access.isAdmin ? supabase : createServiceClient();

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

  const { error } = await db.from('cost_size_buckets').update(clean).eq('id', id);
  if (error) return { error: error.message };
  revalidatePath('/costing/assumptions');
  revalidatePath('/costing');
  return { error: null };
}
