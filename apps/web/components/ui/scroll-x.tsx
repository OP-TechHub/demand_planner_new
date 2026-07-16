'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Horizontal scroll container that exposes a `data-scrolled` hook once the user
 * scrolls right. Pinned cells inside read it via
 * `group-data-[scrolled=true]/scrollx:` to reveal an edge shadow only when it's
 * actually needed.
 */
export function ScrollX({ className, children }: { className?: string; children: React.ReactNode }) {
  const [scrolled, setScrolled] = React.useState(false);

  return (
    <div
      onScroll={(e) => {
        const s = e.currentTarget.scrollLeft > 2;
        setScrolled((prev) => (prev === s ? prev : s));
      }}
      data-scrolled={scrolled ? 'true' : 'false'}
      className={cn('group/scrollx overflow-x-auto', className)}
    >
      {children}
    </div>
  );
}
