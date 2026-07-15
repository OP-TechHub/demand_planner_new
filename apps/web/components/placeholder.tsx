export function Placeholder({ title, note }: { title: string; note: string }) {
  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <div className="mt-4 rounded-lg border border-dashed bg-muted/30 p-8 text-sm text-muted-foreground">
        {note}
      </div>
    </div>
  );
}
