'use client';

import * as React from 'react';
import { MessageSquare } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Open/closed state of the assistant, shared between the header button that
 * opens it and the side panel itself. The two live in different parts of the
 * layout (the panel sits outside the header, whose backdrop-blur would clip a
 * fixed child), so the state has to sit above both.
 */
type ChatOpen = {
  open: boolean;
  setOpen: (open: boolean) => void;
  /** True while an answer is being generated, so the header button can show it. */
  busy: boolean;
  setBusy: (busy: boolean) => void;
};

const Ctx = React.createContext<ChatOpen | null>(null);

export function ChatOpenProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const value = React.useMemo(() => ({ open, setOpen, busy, setBusy }), [open, busy]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useChatOpen(): ChatOpen {
  const v = React.useContext(Ctx);
  if (!v) throw new Error('useChatOpen must be used inside ChatOpenProvider');
  return v;
}

/**
 * The header button that opens the assistant. Replaces the floating launcher
 * that used to sit over the bottom-right corner of every grid.
 */
export function ChatTrigger() {
  const { open, setOpen, busy } = useChatOpen();
  return (
    <button
      type="button"
      onClick={() => setOpen(!open)}
      aria-pressed={open}
      aria-label={open ? 'Close the assistant' : 'Ask the assistant'}
      title={open ? 'Close the assistant' : 'Ask the assistant'}
      className={cn(
        'relative inline-flex h-9 items-center gap-1.5 rounded-md border border-border px-2.5 text-sm transition-colors hover:bg-muted hover:text-foreground',
        open ? 'bg-primary/10 text-primary' : 'text-muted-foreground'
      )}
    >
      <MessageSquare className="h-4 w-4" />
      <span className="hidden sm:inline">Ask</span>
      {busy && <span className="absolute -right-1 -top-1 h-2.5 w-2.5 animate-pulse rounded-full bg-accent ring-2 ring-card" />}
    </button>
  );
}
