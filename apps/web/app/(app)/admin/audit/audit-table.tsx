'use client';

import { useMemo, useState } from 'react';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { ExportCsvButton } from '@/components/export-csv-button';

export interface AuditRow {
  id: string;
  whoId: string;
  who: string;
  sectionKey: string;
  section: string;
  action: string;
  actionKey: 'insert' | 'update' | 'delete';
  entity: string;
  detail: string;
  scenario: string | null;
  rel: string;
  abs: string;
  dateStr: string;
}

const TONE: Record<AuditRow['actionKey'], string> = {
  insert: 'text-success',
  update: 'text-primary',
  delete: 'text-destructive',
};

function initials(name: string) {
  const p = name.trim().split(/\s+/);
  return ((p[0]?.[0] ?? '') + (p[1]?.[0] ?? '')).toUpperCase() || name.slice(0, 2).toUpperCase();
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
      ['When', 'Who', 'Section', 'Action', 'Item', 'Details', 'Scenario'],
      ...filtered.map((r) => [r.abs, r.who, r.section, r.action, r.entity, r.detail, r.scenario ?? '']),
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
          <table className="w-full min-w-[42rem] text-sm">
            <thead className="border-b border-border bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 font-medium">Who</th>
                <th className="px-4 py-2.5 font-medium">Section</th>
                <th className="px-4 py-2.5 font-medium">What changed</th>
                <th className="px-4 py-2.5 text-right font-medium">When</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className="border-b border-border align-top last:border-0 hover:bg-muted/30">
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
                  </td>
                  <td className="px-4 py-3">
                    <div>
                      <span className={`font-medium ${TONE[r.actionKey]}`}>{r.action}</span>{' '}
                      <span className="text-foreground">{r.entity}</span>
                      {r.scenario && (
                        <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">in “{r.scenario}”</span>
                      )}
                    </div>
                    {r.detail && <div className="mt-0.5 text-xs text-muted-foreground">{r.detail}</div>}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right text-muted-foreground">
                    <div title={r.abs}>{r.rel}</div>
                    <div className="text-xs text-muted-foreground/70">{r.dateStr}</div>
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
