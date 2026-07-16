'use client';

import { useActionState, useEffect, useState } from 'react';
import type { Bucket, Program } from '@oceanpick/shared';
import { saveProgram, type ProgramFormState } from './actions';

const initial: ProgramFormState = { error: null, ok: false };

export function ProgramPanel({
  planId,
  buckets,
  program,
  onClose,
  onSaved,
}: {
  planId: string;
  buckets: Bucket[];
  program: Program | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [state, formAction, pending] = useActionState(saveProgram, initial);
  const [secondary, setSecondary] = useState<string>(program?.secondary_bucket_id ?? '');
  const [tertiary, setTertiary] = useState<string>(program?.tertiary_bucket_id ?? '');

  useEffect(() => {
    if (state.ok) onSaved();
  }, [state.ok, onSaved]);

  const editing = Boolean(program);

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/30" onClick={onClose}>
      <div
        className="h-full w-full max-w-md overflow-y-auto bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <form action={formAction} className="flex min-h-full flex-col">
          <input type="hidden" name="plan_id" value={planId} />
          {program && <input type="hidden" name="id" value={program.id} />}

          <div className="flex items-center justify-between border-b px-5 py-3">
            <h2 className="text-sm font-semibold">{editing ? 'Edit program' : 'New program'}</h2>
            <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
              ✕
            </button>
          </div>

          <div className="flex-1 space-y-4 px-5 py-4 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Status">
                <select name="status" defaultValue={program?.status ?? 'active'} className={inputCls}>
                  <option value="active">Active</option>
                  <option value="pipeline">Pipeline</option>
                  <option value="inactive">Inactive</option>
                </select>
              </Field>
              <label className="flex items-end gap-2 pb-2">
                <input type="checkbox" name="locked" defaultChecked={program?.locked ?? false} />
                <span>Locked (prioritize absolutely)</span>
              </label>
            </div>

            <Field label="Item code">
              <input name="item_code" defaultValue={program?.item_code ?? ''} className={inputCls} />
            </Field>
            <Field label="Description">
              <input name="item_description" defaultValue={program?.item_description ?? ''} className={inputCls} />
            </Field>
            <Field label="Customer">
              <input name="customer" defaultValue={program?.customer ?? ''} className={inputCls} />
            </Field>
            <Field label="Max monthly demand (kg FP)">
              <input
                name="max_monthly_demand_fp"
                type="number"
                step="any"
                defaultValue={program?.max_monthly_demand_fp ?? ''}
                className={inputCls}
              />
            </Field>

            <Divider>Paths</Divider>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Primary bucket">
                <select name="primary_bucket_id" defaultValue={program?.primary_bucket_id ?? ''} className={inputCls}>
                  <option value="">— Select —</option>
                  {buckets.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              </Field>
              <Field label="Primary yield">
                <input name="primary_yield" type="number" step="any" defaultValue={program?.primary_yield ?? ''} className={inputCls} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Secondary bucket">
                <select name="secondary_bucket_id" value={secondary} onChange={(e) => setSecondary(e.target.value)} className={inputCls}>
                  <option value="">— None —</option>
                  {buckets.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              </Field>
              <Field label="Secondary yield">
                <input name="secondary_yield" type="number" step="any" disabled={!secondary} defaultValue={program?.secondary_yield ?? ''} className={inputCls} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Tertiary bucket">
                <select name="tertiary_bucket_id" value={tertiary} onChange={(e) => setTertiary(e.target.value)} className={inputCls}>
                  <option value="">— None —</option>
                  {buckets.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              </Field>
              <Field label="Tertiary yield">
                <input name="tertiary_yield" type="number" step="any" disabled={!tertiary} defaultValue={program?.tertiary_yield ?? ''} className={inputCls} />
              </Field>
            </div>

            <Divider>Pricing &amp; cost</Divider>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Price ($/kg FP)"><input name="price_per_fp" type="number" step="any" defaultValue={program?.price_per_fp ?? ''} className={inputCls} /></Field>
              <Field label="Barra cost ($/kg WR)"><input name="barra_cost_wr" type="number" step="any" defaultValue={program?.barra_cost_wr ?? 0} className={inputCls} /></Field>
              <Field label="Packing"><input name="packing_cost_fp" type="number" step="any" defaultValue={program?.packing_cost_fp ?? 0} className={inputCls} /></Field>
              <Field label="Processing"><input name="processing_cost_fp" type="number" step="any" defaultValue={program?.processing_cost_fp ?? 0} className={inputCls} /></Field>
              <Field label="Storage"><input name="storage_cost_fp" type="number" step="any" defaultValue={program?.storage_cost_fp ?? 0} className={inputCls} /></Field>
              <Field label="Freight"><input name="freight_cost_fp" type="number" step="any" defaultValue={program?.freight_cost_fp ?? 0} className={inputCls} /></Field>
              <Field label="Other costs"><input name="other_costs_fp" type="number" step="any" defaultValue={program?.other_costs_fp ?? 0} className={inputCls} /></Field>
            </div>

            <div className="rounded-md border border-dashed bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              Cost &amp; margin are calculated on recompute (calc engine, Phase 2).
            </div>

            {state.error && (
              <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
            )}
          </div>

          <div className="sticky bottom-0 flex justify-end gap-2 border-t bg-card px-5 py-3">
            <button type="button" onClick={onClose} className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted">
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending}
              className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {pending ? 'Saving…' : editing ? 'Save changes' : 'Create program'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const inputCls =
  'mt-1 w-full rounded-md border px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary disabled:bg-muted disabled:opacity-60';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function Divider({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 pt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      <span>{children}</span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}
