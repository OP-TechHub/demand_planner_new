'use client';

import * as React from 'react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';
import { cn } from '@/lib/utils';

type ToastType = 'success' | 'error' | 'info';
type ToastItem = { id: number; type: ToastType; message: string };

let counter = 0;
const listeners = new Set<(t: ToastItem) => void>();

function emit(type: ToastType, message: string) {
  const item: ToastItem = { id: ++counter, type, message };
  listeners.forEach((l) => l(item));
}

/**
 * Imperative toast API — callable from any client component without a provider.
 * A single <Toaster/> (mounted in the app shell) renders the queue.
 */
export const toast = {
  success: (m: string) => emit('success', m),
  error: (m: string) => emit('error', m),
  info: (m: string) => emit('info', m),
};

const ICON = { success: CheckCircle2, error: AlertCircle, info: Info } as const;
const TONE = {
  success: 'border-success/30 text-success',
  error: 'border-destructive/30 text-destructive',
  info: 'border-border text-primary',
} as const;

export function Toaster() {
  const [items, setItems] = React.useState<ToastItem[]>([]);

  React.useEffect(() => {
    const on = (t: ToastItem) => {
      setItems((prev) => [...prev, t]);
      window.setTimeout(() => setItems((prev) => prev.filter((x) => x.id !== t.id)), 4200);
    };
    listeners.add(on);
    return () => {
      listeners.delete(on);
    };
  }, []);

  const remove = (id: number) => setItems((prev) => prev.filter((x) => x.id !== id));

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-full max-w-sm flex-col gap-2">
      {items.map((t) => {
        const Icon = ICON[t.type];
        return (
          <div
            key={t.id}
            role="status"
            className={cn(
              'pointer-events-auto flex items-start gap-2.5 rounded-lg border bg-popover px-4 py-3 text-sm shadow-lg animate-slide-up',
              TONE[t.type]
            )}
          >
            <Icon className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="flex-1 text-popover-foreground">{t.message}</span>
            <button
              type="button"
              onClick={() => remove(t.id)}
              aria-label="Dismiss"
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
