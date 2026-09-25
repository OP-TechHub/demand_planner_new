'use client';

import { BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

export interface FulfilmentStackRow {
  /** 1-based plan month index. */
  month: number;
  label: string;
  demand: number;
  own: number;
  borrowed: number;
  unfulfilled: number;
}

// Own / borrowed share the dashboard's validated categorical pair. Unfulfilled
// is not a series but the gap to demand, so it wears a recessive neutral with a
// hatch texture (secondary encoding) rather than a third hue.
export const C_OWN = '#2a78d6';
export const C_BORROWED = '#eb6834';
export const C_UNFULFILLED = '#94a3b8';

const fmtAxis = (v: number) => (v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(0) + 'k' : String(Math.round(v)));
const fmtKg = (v: number) => Math.round(v).toLocaleString() + ' kg';

/**
 * One stacked bar per month: own-month FP at the base, borrowed FP above it,
 * and the unfulfilled remainder on top, so each bar's full height is that
 * month's demand and the coloured part is what the engine actually fulfilled.
 */
export function FulfilmentStackChart({
  data,
  height = 280,
  selected,
  onSelect,
}: {
  data: FulfilmentStackRow[];
  height?: number;
  /** 1-based month index of the bar to highlight, if any. */
  selected?: number | null;
  /** Called with the 1-based month index when a bar is clicked. */
  onSelect?: (month: number) => void;
}) {
  const click = onSelect ? (d: unknown) => { const m = (d as { month?: number } | undefined)?.month; if (m != null) onSelect(m); } : undefined;
  const dim = (m: number) => (selected != null && selected !== m ? 0.45 : 1);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 20, bottom: 4, left: 4 }} barCategoryGap="25%" style={onSelect ? { cursor: 'pointer' } : undefined}>
        <defs>
          <pattern id="unfulfilled-hatch" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
            <rect width="6" height="6" fill={C_UNFULFILLED} fillOpacity={0.18} />
            <line x1="0" y1="0" x2="0" y2="6" stroke={C_UNFULFILLED} strokeWidth="1.5" />
          </pattern>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#94a3b8" strokeOpacity={0.18} vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#64748b' }} interval={data.length > 24 ? 5 : 0} tickLine={false} axisLine={{ stroke: '#94a3b8', strokeOpacity: 0.3 }} />
        <YAxis tick={{ fontSize: 10, fill: '#64748b' }} width={46} tickLine={false} axisLine={false} tickFormatter={fmtAxis} />
        <Tooltip
          cursor={{ fill: '#94a3b8', fillOpacity: 0.1 }}
          formatter={(v, n) => [fmtKg(Number(v)), String(n)]}
          labelFormatter={(l, payload: readonly unknown[]) => {
            const row = (payload?.[0] as { payload?: FulfilmentStackRow } | undefined)?.payload;
            if (!row) return l;
            const ful = row.own + row.borrowed;
            const pct = row.demand > 0 ? Math.round((ful / row.demand) * 100) : 0;
            const bor = ful > 0 ? Math.round((row.borrowed / ful) * 100) : 0;
            return `${l} · demand ${fmtKg(row.demand)} · ${pct}% fulfilled · ${bor}% of it borrowed`;
          }}
          contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="own" name="Own month" stackId="d" fill={C_OWN} stroke="#ffffff" strokeWidth={1} isAnimationActive={false} onClick={click}>
          {data.map((r) => <Cell key={r.month} fillOpacity={dim(r.month)} />)}
        </Bar>
        <Bar dataKey="borrowed" name="Borrowed" stackId="d" fill={C_BORROWED} stroke="#ffffff" strokeWidth={1} isAnimationActive={false} onClick={click}>
          {data.map((r) => <Cell key={r.month} fillOpacity={dim(r.month)} />)}
        </Bar>
        <Bar dataKey="unfulfilled" name="Unfulfilled" stackId="d" fill="url(#unfulfilled-hatch)" stroke="#ffffff" strokeWidth={1} radius={[4, 4, 0, 0]} isAnimationActive={false} onClick={click}>
          {data.map((r) => <Cell key={r.month} fillOpacity={dim(r.month)} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
