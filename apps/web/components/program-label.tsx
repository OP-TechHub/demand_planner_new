import { cn } from '@/lib/utils';

/**
 * A program's name in a table cell: customer, then the product description in
 * muted text, on one line and cut off with "…" when the column is too narrow.
 * The full name is on hover, and the column can be dragged wider
 * (useResizableColumn) to read more of it in place.
 */
export function ProgramLabel({ name, detail, className }: { name: string; detail?: string | null; className?: string }) {
  return (
    <span className={cn('block truncate', className)} title={detail ? `${name} — ${detail}` : name}>
      <span className="font-medium">{name}</span>
      {detail && <span className="ml-1 text-muted-foreground">{detail}</span>}
    </span>
  );
}
