'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { Waves } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { signup, type AuthState } from '../login/actions';

const initial: AuthState = { error: null };

export default function SignupPage() {
  const [state, formAction, pending] = useActionState(signup, initial);

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden px-4">
      <div className="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-br from-primary/10 via-background to-accent/10" />
      <div className="pointer-events-none absolute -top-24 left-1/2 -z-10 h-96 w-[42rem] -translate-x-1/2 rounded-full bg-primary/15 blur-3xl" />

      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-md">
            <Waves className="h-6 w-6" strokeWidth={2.25} />
          </span>
          <h1 className="mt-3 text-lg font-semibold tracking-tight">Create your account</h1>
          <p className="mt-1 text-sm text-muted-foreground">New accounts need administrator approval before first sign-in.</p>
        </div>

        <div className="rounded-xl border border-border bg-card p-6 shadow-lg">
          <form action={formAction} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="full_name" className="text-sm font-medium">Full name</label>
              <Input id="full_name" name="full_name" type="text" autoComplete="name" required />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="email" className="text-sm font-medium">Work email</label>
              <Input id="email" name="email" type="email" autoComplete="email" required placeholder="you@oceanpick.com" />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="password" className="text-sm font-medium">Password</label>
              <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={8} />
              <p className="text-xs text-muted-foreground">At least 8 characters.</p>
            </div>

            {state.error && (
              <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {state.error}
              </p>
            )}

            <Button type="submit" disabled={pending} size="lg" className="w-full">
              {pending ? 'Creating account…' : 'Create account'}
            </Button>
          </form>
        </div>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          Already have an account?{' '}
          <Link href="/login" className="font-medium text-primary hover:underline">Sign in</Link>
        </p>
      </div>
    </main>
  );
}
