'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

export type ResetState = { error: string | null };

/**
 * Set a new password for the user in the current (recovery) session — the one
 * established when they followed the reset link through /auth/callback. Without
 * that session there's nobody to update, so we tell them the link lapsed.
 */
export async function updatePassword(_prev: ResetState, formData: FormData): Promise<ResetState> {
  const password = String(formData.get('password') ?? '');
  const confirm = String(formData.get('confirm') ?? '');

  if (password.length < 8) return { error: 'Password must be at least 8 characters.' };
  if (password !== confirm) return { error: 'The two passwords don’t match.' };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Your reset link has expired or was already used. Request a new one.' };

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    if (error.message.toLowerCase().includes('should be different')) return { error: 'Choose a password different from your current one.' };
    return { error: error.message };
  }

  revalidatePath('/', 'layout');
  redirect('/');
}
