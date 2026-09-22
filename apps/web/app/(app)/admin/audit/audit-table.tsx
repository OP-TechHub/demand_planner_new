'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Undo2 } from 'lucide-react';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import { confirmDialog } from '@/components/ui/confirm';
import { ExportCsvButton } from '@/components/export-csv-button';
import { undoAuditEntry } from './undo-actions';

/** One recorded before → after value. `field` names the field, or the bucket · month for grid edits. */
export interface AuditChange {
  field: string;
  before: string;
  after: string;
  unit?: string;
}

export interface AuditRow {
  id: string;
  whoId: string;
  who: string;
  sectionKey: string;
  section: string;
  action: string;
  actionKey: 'insert' | 'update' | 'delete';
  entity: string;
  /** Plain-language context (imports, inquiry flows, PO refs…). */
  notes: string[];
  changes: AuditChange[];
  /** Changed cells beyond what was recorded. */
  more: number;
  detailText: string;
  planName: string | null;
  isScenario: boolean;
  /** ISO timestamp — formatted in the viewer's browser so it shows their local time. */
  at: string;
  canUndo: boolean;
  undoReason: string | null;
  undone: { by: string; at: string } | null;
}

const TONE: Record<AuditRow['actionKey'], string> = {
  insert: 'text-success',
  update: 'text-primary',
  delete: 'text-destructive',
};

const DATE_FMT: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' };
const TIME_FMT: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' };

function fullStamp(iso: string) {
  const d = new Date(iso);
  return `${d.toLocaleDateString('en-GB', DATE_FMT)}, ${d.toLocaleTimeString('en-GB', TIME_FMT)}`;
}

function relativeTime(iso: string, now: number): string {
  const m = Math.round((now - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr${h === 1 ? '' : 's'} ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d} day${d === 1 ? '' : 's'} ago`;
  const mo = Math.round(d / 30);
  return `${mo} month${mo === 1 ? '' : 's'} ago`;
}

/** Date, time and "x ago" — rendered after mount so it uses the viewer's timezone, not the server's. */
function When({ iso }: { iso: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => setNow(Date.now()), []);
  if (now === null) return <span className="text-muted-foreground/50">…</span>;
  const d = new Date(iso);
  return (
    <div title={d.toString()}>
      <div className="font-medium text-foreground">{d.toLocaleDateString('en-GB', DATE_FMT)}</div>
      <div className="text-xs text-muted-foreground">{d.toLocaleTimeString('en-GB', TIME_FMT)} · {relativeTime(iso, now)}</div>
    </div>
  );
}

function initials(name: string) {
  const p = name.trim().split(/\s+/);
  return ((p[0]?.[0] ?? '') + (p[1]?.[0] ?? '')).toUpperCase() || name.slice(0, 2).toUpperCase();
}

const PREVIEW = 6;

/** Before → after table for one entry; long edits collapse to the first few rows. */
function ChangeList({ row }: { row: AuditRow }) {
  const [open, setOpen] = useState(false);
  if (!row.changes.length) return null;
  const shown = open ? row.changes : row.changes.slice(0, PREVIEW);
  const hidden = row.changes.length - shown.length;
  return (
    <div className="mt-1.5 rounded-md border border-border/70 bg-muted/20">
      <table className="w-full text-xs">
        <thead className="text-[10px] uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-2 py-1 text-left font-medium">Field / month</th>
            <th className="px-2 py-1 text-right font-medium">Before</th>
            <th className="px-1 py-1" />
            <th className="px-2 py-1 text-right font-medium">After</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((c, i) => (
            <tr key={i} className="border-t border-border/50">
              <td className="px-2 py-1 text-muted-foreground">{c.field}</td>
              <td className="px-2 py-1 text-right tabular-nums text-muted-foreground">{c.before}</td>
              <td className="px-1 py-1 text-center text-muted-foreground/60">→</td>
              <td className="px-2 py-1 text-right font-medium tabular-nums text-foreground">
                {c.after}{c.unit && <span className="ml-1 font-normal text-muted-foreground">{c.unit}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {(hidden > 0 || (open && row.changes.length > PREVIEW) || row.more > 0) && (
        <div className="flex items-center gap-3 border-t border-border/50 px-2 py-1 text-xs">
          {hidden > 0 && (
            <button type="button" className="text-primary hover:underline" onClick={() => setOpen(true)}>
              Show all {row.changes.length} changes
            </button>
          )}
          {open && row.changes.length > PREVIEW && (
            <button type="button" className="text-primary hover:underline" onClick={() => setOpen(false)}>Show less</button>
          )}
          {row.more > 0 && <span className="text-muted-foreground">+{row.more} more cells changed (not itemised)</span>}
        </div>
      )}
    </div>
  );
}

function UndoCell({ row }: { row: AuditRow }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  if (row.undone) {
    return (
      <span
        className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
        title={`Undone by ${row.undone.by} on ${fullStamp(row.undone.at)}`}
      >
        <Undo2 className="h-3 w-3" /> Undone
      </span>
    );
  }
  if (!row.canUndo) {
    return <span className="text-xs text-muted-foreground/60" title={row.undoReason ?? undefined}>—</span>;
  }

  async function onUndo() {
    const ok = await confirmDialog({
      title: 'Undo this change?',
      description: `This reverts ${row.section} (${row.entity}) to its previous values${row.planName ? ` in ${row.planName}` : ''}. Recalculate the plan afterwards to refresh the outputs.`,
      confirmLabel: 'Undo change',
    });
    if (!ok) return;
    start(async () => {
      const res = await undoAuditEntry(row.id);
      if (res.error) toast.error(res.error);
      else { toast.success('Change undone. Recalculate the plan to refresh outputs.'); router.refresh(); }
    });
  }

  return (
    <Button variant="outline" size="sm" disabled={pending} onClick={onUndo}>
      <Undo2 className="h-3.5 w-3.5" /> {pending ? 'Undoing…' : 'Undo'}
    </Button>
  );
}

export function AuditTable({ rows }: { rows: AuditRow[] }) {
  const [section, setSection] = useState('all');
  const [who, setWho] = useState('all');

  const sections = useMemo(
    () => Array.from(new Map(rows.map((r) => [r.sectionKey, r.section])).entries()),
    [rows]
  );
  const people = useMemo(
    () => Array.from(new Map(rows.map((r) => [r.whoId, r.who])).entries()),
    [rows]
  );

  const filtered = useMemo(
    () => rows.filter((r) => (section === 'all' || r.sectionKey === section) && (who === 'all' || r.whoId === who)),
    [rows, section, who]
  );

  const csv = useMemo(
    () => [
      ['When', 'Who', 'Section', 'Plan', 'Action', 'Item', 'What changed'],
      ...filtered.map((r) => [fullStamp(r.at), r.who, r.section, r.planName ?? '', r.action, r.entity, r.detailText]),
    ],
    [filtered]
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="w-44">
          <Select value={section} onChange={(e) => setSection(e.target.value)} className="h-8">
            <option value="all">All sections</option>
            {sections.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </Select>
        </div>
        <div className="w-44">
          <Select value={who} onChange={(e) => setWho(e.target.value)} className="h-8">
            <option value="all">All users</option>
            {people.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </Select>
        </div>
        <span className="text-xs text-muted-foreground">{filtered.length} of {rows.length}</span>
        <div className="ml-auto">
          <ExportCsvButton filename="audit-log.csv" rows={csv} />
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-muted/20 p-10 text-center text-sm text-muted-foreground">
          No activity matches these filters.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[56rem] text-sm">
            <thead className="border-b border-border bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 font-medium">When</th>
                <th className="px-4 py-2.5 font-medium">Who</th>
                <th className="px-4 py-2.5 font-medium">Where</th>
                <th className="px-4 py-2.5 font-medium">What changed</th>
                <th className="px-4 py-2.5 text-right font-medium">Undo</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className="border-b border-border align-top last:border-0 hover:bg-muted/30">
                  <td className="whitespace-nowrap px-4 py-3">
                    <When iso={r.at} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
                        {initials(r.who)}
                      </span>
                      <span className="truncate font-medium">{r.who}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant="secondary">{r.section}</Badge>
                    {r.planName && (
                      <div className={`mt-1 text-xs ${r.isScenario ? 'font-medium text-primary' : 'text-muted-foreground'}`}>{r.planName}</div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div>
                      <span className={`font-medium ${TONE[r.actionKey]}`}>{r.action}</span>{' '}
                      <span className="text-foreground">{r.entity}</span>
                    </div>
                    {r.notes.map((n, i) => (
                      <div key={i} className="mt-0.5 text-xs text-muted-foreground">{n}</div>
                    ))}
                    <ChangeList row={r} />
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right">
                    <UndoCell row={r} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
