'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

export type AuthState = { error: string | null };

/**
 * Signup. Any email may register; handle_new_user() attaches the new account to
 * the Oceanpick org (first user becomes admin, everyone after is a viewer).
 *
 * Error handling branches on status/code, NOT message text: GoTrue never
 * forwards a trigger's own message to the client, and supabase-js wraps DB
 * failures as a 500 AuthRetryableFetchError whose .message is an unhelpful "{}".
 */
export async function signup(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const password = String(formData.get('password') ?? '');
  const fullName = String(formData.get('full_name') ?? '').trim();

  if (!email || !password) return { error: 'Email and password are required.' };
  if (password.length < 8) return { error: 'Password must be at least 8 characters.' };
  if (!fullName) return { error: 'Please enter your name.' };

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName } },
  });

  if (error) {
    // Already-registered email: GoTrue returns 422 / user_already_exists.
    if (error.code === 'user_already_exists' || error.message.toLowerCase().includes('already registered')) {
      return { error: 'An account with this email already exists. Try signing in instead.' };
    }
    // DB/trigger failure surfaces as a 500 with an unhelpful "{}" message
    // (e.g. the Oceanpick org row is missing because the seed never ran).
    if (error.status === 500) {
      return { error: 'We couldn\'t create your account right now. Please try again, or contact an administrator if it keeps happening.' };
    }
    return { error: error.message };
  }

  revalidatePath('/', 'layout');
  redirect('/');
}

export async function login(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const password = String(formData.get('password') ?? '');

  if (!email || !password) return { error: 'Email and password are required.' };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) return { error: 'Incorrect email or password.' };

  // Best-effort. A failure here must not block sign-in.
  if (data.user) {
    await supabase
      .from('users')
      .update({ last_login_at: new Date().toISOString() })
      .eq('id', data.user.id);
  }

  revalidatePath('/', 'layout');
  redirect('/');
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath('/', 'layout');
  redirect('/login');
}
