import Anthropic from '@anthropic-ai/sdk';
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getActivePlan } from '@/lib/plan';
import { SYSTEM_PROMPT } from '@/lib/chat/system-prompt';
import { TOOLS, TOOL_LABELS, runTool } from '@/lib/chat/tools';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// A turn with several tool calls can run past the default function timeout.
export const maxDuration = 120;

/**
 * POST /api/chat — the in-app assistant.
 *
 * Body: { messages: [{ role: 'user' | 'assistant', content: string }], page?: string }
 * The client keeps the conversation and sends it whole each turn; nothing is
 * stored server-side.
 *
 * Streams newline-delimited JSON events:
 *   { type: 'text', text }        a fragment of the answer
 *   { type: 'tool', label }       a tool started (for a status line)
 *   { type: 'error', message }    the turn failed; shown in place of an answer
 *   { type: 'done' }
 */

const MODEL = process.env.CHAT_MODEL || 'claude-opus-5';
const EFFORT = (process.env.CHAT_EFFORT || 'medium') as 'low' | 'medium' | 'high';
/** Model round trips per question before giving up — a loop guard, not a budget. */
const MAX_STEPS = 10;
const MAX_MESSAGE_CHARS = 4000;
const MAX_HISTORY = 40;

// Per-user request cap. In memory, so it is per server instance and resets on
// deploy — enough to stop a stuck client hammering the API, not a billing control.
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = 40;
const recent = new Map<string, number[]>();

function rateLimited(userId: string): boolean {
  const now = Date.now();
  const hits = (recent.get(userId) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  hits.push(now);
  recent.set(userId, hits);
  return hits.length > RATE_MAX;
}

type ChatMessage = { role: 'user' | 'assistant'; content: string };

function parseBody(body: unknown): { messages: ChatMessage[]; page: string } | null {
  if (!body || typeof body !== 'object') return null;
  const { messages, page } = body as { messages?: unknown; page?: unknown };
  if (!Array.isArray(messages) || messages.length === 0) return null;
  const clean: ChatMessage[] = [];
  for (const m of messages.slice(-MAX_HISTORY)) {
    if (!m || typeof m !== 'object') return null;
    const { role, content } = m as { role?: unknown; content?: unknown };
    if ((role !== 'user' && role !== 'assistant') || typeof content !== 'string') return null;
    if (!content.trim()) continue;
    clean.push({ role, content: content.slice(0, MAX_MESSAGE_CHARS) });
  }
  // The API requires the conversation to open and close on a user turn.
  while (clean.length && clean[0]!.role !== 'user') clean.shift();
  if (!clean.length || clean[clean.length - 1]!.role !== 'user') return null;
  return { messages: clean, page: typeof page === 'string' ? page.slice(0, 200) : '' };
}

export async function POST(req: Request) {
  // Read straight off this request's session. The request-cached helpers in
  // lib/plan are built for page renders, not route handlers.
  const db = await createClient();
  const { data: { user }, error: authError } = await db.auth.getUser();
  if (!user) {
    console.warn('[chat] no session:', authError?.message ?? 'no auth cookie on the request');
    return NextResponse.json(
      { error: 'Your session has expired. Refresh the page (or sign in again) and ask again.' },
      { status: 401 }
    );
  }
  const { data: profile } = await db
    .from('users')
    .select('full_name, email, role, is_active')
    .eq('id', user.id)
    .maybeSingle();
  if (!profile?.is_active) return NextResponse.json({ error: 'Account not active.' }, { status: 403 });

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'The assistant is not configured (ANTHROPIC_API_KEY is not set).' }, { status: 503 });
  }
  if (rateLimited(user.id)) {
    return NextResponse.json({ error: 'Too many questions in a short time. Try again in a few minutes.' }, { status: 429 });
  }

  const parsed = parseBody(await req.json().catch(() => null));
  if (!parsed) return NextResponse.json({ error: 'Bad request.' }, { status: 400 });

  const activePlan = await getActivePlan();
  const toolCtx = { db, activePlan };

  // Per-request context rides on the latest user turn, not the system prompt,
  // so the cached prefix (tools + system) stays identical across requests.
  const today = new Date().toISOString().slice(0, 10);
  const context =
    `[Context: today is ${today}. The user is ${profile.full_name || profile.email} (role: ${profile.role}), ` +
    `on the page ${parsed.page || '/'}. Selected plan: ${activePlan ? `"${activePlan.name}" (id ${activePlan.id})` : 'none'}.]`;

  const history: Anthropic.Beta.BetaMessageParam[] = parsed.messages.map((m, i) =>
    i === parsed.messages.length - 1
      ? { role: 'user', content: [{ type: 'text', text: context }, { type: 'text', text: m.content }] }
      : { role: m.role, content: m.content }
  );

  const client = new Anthropic();
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: Record<string, unknown>) => controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'));
      const toolsUsed: string[] = [];
      const usage = { input: 0, output: 0, cache_read: 0 };
      let jsonRetries = 0;

      try {
        for (let step = 0; step < MAX_STEPS; step++) {
          const turn = client.beta.messages.stream(
            {
              model: MODEL,
              max_tokens: 32000,
              betas: ['server-side-fallback-2026-07-01'],
              fallbacks: 'default',
              output_config: { effort: EFFORT },
              system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
              tools: TOOLS,
              messages: history,
            },
            { signal: req.signal }
          );
          turn.on('text', (text) => send({ type: 'text', text }));

          let message: Anthropic.Beta.BetaMessage;
          try {
            message = await turn.finalMessage();
            jsonRetries = 0;
          } catch (err) {
            // A tool input the SDK could not parse at all: re-issue the turn.
            // API errors (auth, rate limit, overload) are not retried here.
            if (err instanceof Anthropic.APIError || req.signal.aborted || jsonRetries++ >= 2) throw err;
            continue;
          }

          usage.input += message.usage.input_tokens;
          usage.output += message.usage.output_tokens;
          usage.cache_read += message.usage.cache_read_input_tokens ?? 0;

          if (message.stop_reason === 'refusal') {
            send({ type: 'text', text: '\n\nI can’t help with that request.' });
            break;
          }
          if (message.stop_reason === 'pause_turn') {
            history.push({ role: 'assistant', content: message.content });
            continue;
          }

          const calls = message.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
          if (calls.length === 0) break;
          // A tool input cut off at max_tokens can still look valid; don't run it.
          if (message.stop_reason === 'max_tokens') throw new Error('Response cut off mid tool call.');

          history.push({ role: 'assistant', content: message.content });
          for (const c of calls) {
            toolsUsed.push(c.name);
            send({ type: 'tool', label: TOOL_LABELS[c.name] ?? c.name });
          }
          // Parallel calls run together and answer in one user turn.
          const results = await Promise.all(calls.map((c) => runTool(toolCtx, c.name, c.input)));
          history.push({
            role: 'user',
            content: calls.map((c, i) => ({
              type: 'tool_result' as const,
              tool_use_id: c.id,
              content: results[i]!.content,
              ...(results[i]!.isError ? { is_error: true } : {}),
            })),
          });

          if (step === MAX_STEPS - 1) {
            send({ type: 'text', text: '\n\nThat needed more lookups than I’m allowed per question. Try asking something narrower.' });
          }
        }
        send({ type: 'done' });
      } catch (err) {
        if (!req.signal.aborted) {
          console.error('[chat] turn failed', err);
          send({ type: 'error', message: errorMessage(err) });
        }
      } finally {
        // One line per question, for spotting cost and misbehaving tools in the logs.
        console.info(JSON.stringify({ event: 'chat', user: user.id, model: MODEL, tools: toolsUsed, usage }));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function errorMessage(err: unknown): string {
  if (err instanceof Anthropic.RateLimitError) return 'The assistant is busy right now. Try again in a minute.';
  if (err instanceof Anthropic.AuthenticationError) return 'The assistant’s API key was rejected. Ask an admin to check ANTHROPIC_API_KEY.';
  if (err instanceof Anthropic.APIError && (err.status ?? 0) >= 500) return 'The assistant service had a problem. Try again.';
  return 'Something went wrong answering that. Try again.';
}
