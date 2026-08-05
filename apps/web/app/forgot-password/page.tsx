'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { Waves, MailCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { requestPasswordReset, type ForgotState } from './actions';

const initial: ForgotState = { error: null, sent: false };

export default function ForgotPasswordPage() {
  const [state, formAction, pending] = useActionState(requestPasswordReset, initial);

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden px-4">
      <div className="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-br from-primary/10 via-background to-accent/10" />
      <div className="pointer-events-none absolute -top-24 left-1/2 -z-10 h-96 w-[42rem] -translate-x-1/2 rounded-full bg-primary/15 blur-3xl" />

      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-md">
            <Waves className="h-6 w-6" strokeWidth={2.25} />
          </span>
          <h1 className="mt-3 text-lg font-semibold tracking-tight">Reset your password</h1>
          <p className="mt-1 text-sm text-muted-foreground">We’ll email you a link to set a new one.</p>
        </div>

        <div className="rounded-xl border border-border bg-card p-6 shadow-lg">
          {state.sent ? (
            <div className="flex flex-col items-center gap-3 py-2 text-center">
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-success/10 text-success">
                <MailCheck className="h-5 w-5" />
              </span>
              <p className="text-sm text-foreground">
                If an account exists for that email, a reset link is on its way. Check your inbox (and spam).
              </p>
              <p className="text-xs text-muted-foreground">The link expires after a short while — request another if it lapses.</p>
            </div>
          ) : (
            <form action={formAction} className="space-y-4">
              <div className="space-y-1.5">
                <label htmlFor="email" className="text-sm font-medium">Email</label>
                <Input id="email" name="email" type="email" autoComplete="email" required placeholder="you@oceanpick.com" />
              </div>

              {state.error && (
                <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {state.error}
                </p>
              )}

              <Button type="submit" disabled={pending} size="lg" className="w-full">
                {pending ? 'Sending…' : 'Send reset link'}
              </Button>
            </form>
          )}
        </div>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          Remembered it?{' '}
          <Link href="/login" className="font-medium text-primary hover:underline">Back to sign in</Link>
        </p>
      </div>
    </main>
  );
}
