'use client';

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

export interface ChartSeries { key: string; name: string; color: string; dashed?: boolean }

/**
 * 60-month line chart. One y-axis (all series share a unit). Recessive grid,
 * 2px lines, no per-point dots, a hover crosshair+tooltip, and a legend only
 * when there are ≥2 series (a single series is named by the surrounding title).
 * Series colors come from the validated categorical palette; axis/label text
 * uses ink, never a series color.
 */
export function MonthlyLineChart({
  data,
  series,
  height = 260,
  format = 'count',
}: {
  data: Record<string, number | string>[]; // each row: { label, ...seriesKeys }
  series: ChartSeries[];
  height?: number;
  /**
   * How to format axis/tooltip numbers. A serializable string (not a function),
   * so this chart can be rendered from a Server Component — functions can't cross
   * the server→client boundary. 'kg' appends the unit in tooltips; 'count' doesn't.
   */
  format?: 'kg' | 'count' | 'usd';
}) {
  // Defined here (client side), never passed in as props.
  const unit = format === 'usd' ? '$' : '';
  const formatY = (v: number) =>
    unit + (v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(0) + 'k' : String(Math.round(v)));
  const formatValue = (v: number) => unit + Math.round(v).toLocaleString() + (format === 'kg' ? ' kg' : '');

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 20, bottom: 4, left: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#94a3b8" strokeOpacity={0.18} vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#64748b' }} interval={5} tickLine={false} axisLine={{ stroke: '#94a3b8', strokeOpacity: 0.3 }} />
        <YAxis tick={{ fontSize: 10, fill: '#64748b' }} width={46} tickLine={false} axisLine={false} tickFormatter={formatY} />
        <Tooltip
          formatter={(v) => formatValue(Number(v))}
          contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
        />
        {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
        {series.map((s) => (
          <Line
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.name}
            stroke={s.color}
            strokeWidth={2}
            strokeDasharray={s.dashed ? '5 4' : undefined}
            dot={false}
            activeDot={{ r: 3 }}
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
