import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}

/**
 * Reusable empty state for tables and lists.
 * Wraps with consistent spacing, an optional icon, title, description and CTA.
 */
export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center gap-3 py-12 px-6",
        className,
      )}
      role="status"
    >
      {icon && (
        <div className="h-12 w-12 rounded-2xl grid place-items-center bg-muted text-muted-foreground">
          {icon}
        </div>
      )}
      <div className="space-y-1">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        {description && (
          <p className="text-xs text-muted-foreground max-w-sm mx-auto">{description}</p>
        )}
      </div>
      {action && <div className="pt-1">{action}</div>}
    </div>
  );
}

/**
 * Generic table loading skeleton — N rows of M columns of pulsing bars.
 */
export function TableSkeleton({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="p-4 space-y-3" aria-busy="true" aria-live="polite">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="grid gap-3" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
          {Array.from({ length: cols }).map((_, c) => (
            <div
              key={c}
              className="h-5 rounded-md bg-muted/60 animate-pulse"
              style={{ width: `${60 + ((r * 17 + c * 11) % 40)}%` }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
