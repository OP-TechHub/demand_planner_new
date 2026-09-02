'use client';

import { useEffect, useState } from 'react';
import { MonitorDown } from 'lucide-react';

/*
 * Chrome and Edge fire this instead of showing their own install UI once we
 * call preventDefault, which lets us put the prompt somewhere people will
 * actually find it. It isn't in lib.dom, so it's typed here.
 */
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

/*
 * "Install app" for the sidebar.
 *
 * Without this the only way in is a small icon in the browser's address bar
 * that most people never notice — and the whole point of the PWA work is that
 * staff end up with the planner in their taskbar.
 *
 * Renders nothing when there's nothing to offer: already installed, already
 * running standalone, or a browser that doesn't support the prompt (Safari,
 * Firefox), where a button would only lead nowhere.
 */
export function InstallAppButton() {
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    if (window.matchMedia('(display-mode: standalone)').matches) return;

    const onPrompt = (e: Event) => {
      // Suppresses the browser's own mini-infobar; we own the invitation now,
      // so the button below has to actually exist.
      e.preventDefault();
      setPrompt(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setPrompt(null);

    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (!prompt) return null;

  async function install() {
    if (!prompt) return;
    await prompt.prompt();
    // A prompt can only be used once, whatever the user chose. If they
    // dismissed it the browser will fire a fresh event later.
    await prompt.userChoice;
    setPrompt(null);
  }

  return (
    <button
      type="button"
      onClick={install}
      title="Install the Demand Planner as a desktop app"
      className="group flex w-full items-center gap-2.5 rounded-md border border-border px-2.5 py-2 text-[13px] text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
    >
      <MonitorDown className="h-4 w-4 shrink-0 transition-colors group-hover:text-foreground" />
      <span className="truncate">Install app</span>
    </button>
  );
}
