'use client';

import * as React from 'react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

type ConfirmOpts = {
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
};

let opener: ((opts: ConfirmOpts) => Promise<boolean>) | null = null;

/**
 * Imperative confirmation dialog. Returns a promise that resolves true/false.
 * Replaces window.confirm() with an in-app dialog. Falls back to window.confirm
 * if the host isn't mounted (e.g. during SSR-less edge cases).
 */
export function confirmDialog(opts: ConfirmOpts): Promise<boolean> {
  if (!opener) return Promise.resolve(typeof window !== 'undefined' ? window.confirm(opts.title) : false);
  return opener(opts);
}

export function ConfirmHost() {
  const [state, setState] = React.useState<{ opts: ConfirmOpts; resolve: (b: boolean) => void } | null>(null);

  React.useEffect(() => {
    opener = (opts) => new Promise<boolean>((resolve) => setState({ opts, resolve }));
    return () => {
      opener = null;
    };
  }, []);

  if (!state) return null;
  const { opts, resolve } = state;
  const close = (v: boolean) => {
    resolve(v);
    setState(null);
  };

  return (
    <Dialog
      open
      onClose={() => close(false)}
      title={opts.title}
      className="max-w-sm"
      footer={
        <>
          <Button variant="outline" onClick={() => close(false)}>{opts.cancelLabel ?? 'Cancel'}</Button>
          <Button variant={opts.destructive ? 'destructive' : 'default'} onClick={() => close(true)}>
            {opts.confirmLabel ?? 'Confirm'}
          </Button>
        </>
      }
    >
      {opts.description && <p className="text-sm text-muted-foreground">{opts.description}</p>}
    </Dialog>
  );
}
