"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

interface ScrollSync {
  /** Join the group. Returns the matching leave function. */
  register: (el: HTMLElement) => () => void;
  /** Push `src`'s horizontal offset to every other member. */
  broadcast: (src: HTMLElement) => void;
}

const ScrollSyncCtx = React.createContext<ScrollSync | null>(null);

/**
 * Links the horizontal scroll of every ScrollX in its subtree: drag one table
 * sideways and the others follow to the same offset. A table that mounts later
 * (or re-mounts after a filter change) picks up the current offset on arrival.
 */
export function ScrollSyncProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const members = React.useRef(new Set<HTMLElement>());
  const offset = React.useRef(0);

  const value = React.useMemo<ScrollSync>(
    () => ({
      register: (el) => {
        members.current.add(el);
        if (el.scrollLeft !== offset.current) el.scrollLeft = offset.current;
        return () => {
          members.current.delete(el);
        };
      },
      broadcast: (src) => {
        const x = src.scrollLeft;
        if (x === offset.current) return;
        offset.current = x;
        for (const el of members.current) {
          // Assigning scrollLeft fires a scroll event on `el`, which broadcasts
          // again — but by then offset matches, so it stops here.
          if (el !== src && el.scrollLeft !== x) el.scrollLeft = x;
        }
      },
    }),
    [],
  );

  return (
    <ScrollSyncCtx.Provider value={value}>{children}</ScrollSyncCtx.Provider>
  );
}

/**
 * Horizontal scroll container that exposes a `data-scrolled` hook once the user
 * scrolls right. Pinned cells inside read it via
 * `group-data-[scrolled=true]/scrollx:` to reveal an edge shadow only when it's
 * actually needed. Inside a ScrollSyncProvider it also scrolls in step with its
 * siblings.
 */
export function ScrollX({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  const [scrolled, setScrolled] = React.useState(false);
  const sync = React.useContext(ScrollSyncCtx);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const el = ref.current;
    if (!sync || !el) return;
    return sync.register(el);
  }, [sync]);

  return (
    <div
      ref={ref}
      onScroll={(e) => {
        const el = e.currentTarget;
        const s = el.scrollLeft > 2;
        setScrolled((prev) => (prev === s ? prev : s));
        sync?.broadcast(el);
      }}
      data-scrolled={scrolled ? "true" : "false"}
      className={cn("group/scrollx overflow-x-auto", className)}
    >
      {children}
    </div>
  );
}
