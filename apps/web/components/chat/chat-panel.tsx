'use client';

import * as React from 'react';
import { usePathname } from 'next/navigation';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Loader2, MessageSquare, RotateCcw, Send, Square, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

type Budget = { spent_usd: number; budget_usd: number; resets_at: string; exhausted: boolean };

type Message = {
  role: 'user' | 'assistant';
  content: string;
  /** Status lines for the lookups made while answering. */
  steps?: string[];
  error?: string;
};

const SUGGESTIONS = [
  'Which items are short on supply in the next 6 months?',
  'Summarise this plan’s FY1 revenue and margin.',
  'Compare harvest capacity with the plant’s requests for next quarter.',
  'What is the C&F price for our fillet SKUs to each export destination?',
];

/**
 * The assistant: a header button that opens a side panel. Lives in the app
 * layout, so the conversation survives navigating between pages; it is not
 * stored anywhere and a reload starts afresh.
 */
export function ChatPanel() {
  const [open, setOpen] = React.useState(false);
  const [messages, setMessages] = React.useState<Message[]>([]);
  const [input, setInput] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  // The organisation's monthly allowance, as last reported by the server.
  const [budget, setBudget] = React.useState<Budget | null>(null);
  const abortRef = React.useRef<AbortController | null>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLTextAreaElement>(null);
  const pathname = usePathname();

  React.useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  React.useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Stop an in-flight answer if the panel's owner unmounts.
  React.useEffect(() => () => abortRef.current?.abort(), []);

  /** Apply a change to the answer being streamed (always the last message). */
  const updateLast = (fn: (m: Message) => Message) =>
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      // Gone if the conversation was reset while the answer streamed.
      if (!last || last.role !== 'assistant') return prev;
      return [...prev.slice(0, -1), fn(last)];
    });

  async function send(text: string) {
    const question = text.trim();
    if (!question || busy) return;

    const history: Message[] = [...messages, { role: 'user', content: question }];
    setMessages([...history, { role: 'assistant', content: '', steps: [] }]);
    setInput('');
    setBusy(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          page: pathname,
          // Failed or empty answers are left out, so they don't confuse the next turn.
          messages: history
            .filter((m) => !m.error && m.content.trim())
            .map(({ role, content }) => ({ role, content })),
        }),
      });

      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => null);
        if (body?.budget) setBudget(body.budget);
        updateLast((m) => ({ ...m, error: body?.error ?? `Request failed (${res.status}).` }));
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffered = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffered += decoder.decode(value, { stream: true });
        const lines = buffered.split('\n');
        buffered = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as { type: string; text?: string; label?: string; message?: string; budget?: Budget };
          if (event.type === 'done') {
            if (event.budget) setBudget(event.budget);
          } else if (event.type === 'text') {
            updateLast((m) => ({ ...m, content: m.content + event.text }));
          } else if (event.type === 'tool') {
            // Text written before a lookup and text after it are separate paragraphs.
            updateLast((m) => ({
              ...m,
              content: m.content && !m.content.endsWith('\n\n') ? m.content + '\n\n' : m.content,
              steps: [...(m.steps ?? []), event.label!],
            }));
          } else if (event.type === 'error') {
            updateLast((m) => ({ ...m, error: event.message }));
          }
        }
      }
    } catch {
      if (!controller.signal.aborted) {
        updateLast((m) => ({ ...m, error: 'Lost the connection. Try again.' }));
      } else {
        updateLast((m) => (m.content ? m : { ...m, error: 'Stopped.' }));
      }
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  }

  function reset() {
    abortRef.current?.abort();
    setMessages([]);
    setInput('');
  }

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          title="Ask the assistant"
          aria-label="Ask the assistant"
          className="fixed bottom-5 right-5 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/45"
        >
          <MessageSquare className="h-5 w-5" />
          {busy && <span className="absolute right-0 top-0 h-3 w-3 animate-pulse rounded-full bg-accent ring-2 ring-card" />}
        </button>
      )}

      {open && (
        // Below dialogs (z-50) so a confirm raised by the page still sits on top.
        <aside
          className="fixed inset-y-0 right-0 z-[45] flex w-full flex-col border-l border-border bg-card shadow-xl sm:w-[440px]"
          aria-label="Assistant"
        >
          <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
            <div>
              <div className="text-sm font-semibold">Assistant</div>
              <div className="text-[11px] text-muted-foreground">Answers from your plan and costing data. Read only.</div>
            </div>
            <div className="flex items-center gap-1">
              {messages.length > 0 && (
                <Button variant="ghost" size="icon" onClick={reset} title="New conversation">
                  <RotateCcw />
                </Button>
              )}
              <Button variant="ghost" size="icon" onClick={() => setOpen(false)} title="Close">
                <X />
              </Button>
            </div>
          </div>

          <div ref={scrollRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
            {messages.length === 0 && (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Ask about demand, supply shortfalls, harvest or product pricing. Questions use the plan selected in the header unless you name another.
                </p>
                <div className="space-y-2">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      onClick={() => send(s)}
                      className="block w-full rounded-md border border-border px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m, i) =>
              m.role === 'user' ? (
                <div key={i} className="ml-8 whitespace-pre-wrap rounded-lg bg-primary/10 px-3 py-2 text-sm">
                  {m.content}
                </div>
              ) : (
                <div key={i} className="space-y-2">
                  {!!m.steps?.length && (
                    <ul className="space-y-0.5 text-[11px] text-muted-foreground">
                      {m.steps.map((s, j) => (
                        <li key={j}>· {s}</li>
                      ))}
                    </ul>
                  )}
                  {m.content && (
                    <div className="text-sm leading-relaxed">
                      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdown}>
                        {m.content}
                      </ReactMarkdown>
                    </div>
                  )}
                  {busy && i === messages.length - 1 && !m.error && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      {m.content ? 'Writing…' : 'Thinking…'}
                    </div>
                  )}
                  {m.error && <p className="text-sm text-destructive">{m.error}</p>}
                </div>
              )
            )}
          </div>

          <form
            className="shrink-0 border-t border-border p-3"
            onSubmit={(e) => {
              e.preventDefault();
              void send(input);
            }}
          >
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void send(input);
                  }
                }}
                rows={2}
                maxLength={4000}
                placeholder="Ask a question…"
                className="min-h-[2.5rem] flex-1 resize-none rounded-md border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/45"
              />
              {busy ? (
                <Button variant="outline" size="icon" onClick={() => abortRef.current?.abort()} title="Stop">
                  <Square />
                </Button>
              ) : (
                <Button type="submit" size="icon" disabled={!input.trim() || !!budget?.exhausted} title="Send">
                  <Send />
                </Button>
              )}
            </div>
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              Can make mistakes. Check important figures on the page before acting on them.
              {budget && (
                <>
                  {' · '}
                  <span className={budget.exhausted ? 'text-destructive' : undefined}>
                    {budget.exhausted
                      ? `Monthly allowance used; resets ${resetDay(budget.resets_at)}`
                      : `Company allowance: ${Math.min(100, Math.round((budget.spent_usd / budget.budget_usd) * 100))}% used this month`}
                  </span>
                </>
              )}
            </p>
          </form>
        </aside>
      )}
    </>
  );
}

/** "1 Oct", for the allowance line. */
const resetDay = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

/** Markdown styling without a typography plugin: just the elements answers use. */
const markdown: Components = {
  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="mb-2 list-disc space-y-1 pl-5 last:mb-0">{children}</ul>,
  ol: ({ children }) => <ol className="mb-2 list-decimal space-y-1 pl-5 last:mb-0">{children}</ol>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  h1: ({ children }) => <h3 className="mb-1 mt-3 font-semibold">{children}</h3>,
  h2: ({ children }) => <h3 className="mb-1 mt-3 font-semibold">{children}</h3>,
  h3: ({ children }) => <h3 className="mb-1 mt-3 font-semibold">{children}</h3>,
  code: ({ children }) => <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">{children}</code>,
  a: ({ children, href }) => (
    <a href={href} className="text-primary underline underline-offset-2">
      {children}
    </a>
  ),
  table: ({ children }) => (
    <div className="mb-2 overflow-x-auto rounded-md border border-border last:mb-0">
      <table className="w-full text-xs tabular-nums">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-muted/60">{children}</thead>,
  th: ({ children, style }) => (
    <th style={style} className="whitespace-nowrap px-2 py-1.5 text-left font-medium">
      {children}
    </th>
  ),
  td: ({ children, style }) => (
    <td style={style} className="whitespace-nowrap border-t border-border px-2 py-1.5">
      {children}
    </td>
  ),
};
