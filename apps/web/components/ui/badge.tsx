import * as React from 'react';
import { cn } from '@/lib/utils';

const variants = {
  default: 'border-transparent bg-primary/10 text-primary',
  secondary: 'border-transparent bg-secondary text-secondary-foreground',
  success: 'border-transparent bg-success/12 text-success',
  warning: 'border-transparent bg-warning/15 text-warning',
  destructive: 'border-transparent bg-destructive/12 text-destructive',
  outline: 'border-border text-muted-foreground',
} as const;

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: keyof typeof variants;
}

export function Badge({ className, variant = 'default', ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium [&_svg]:h-3 [&_svg]:w-3',
        variants[variant],
        className
      )}
      {...props}
    />
  );
}
