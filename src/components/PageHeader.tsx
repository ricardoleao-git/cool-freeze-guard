import { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function PageHeader({
  title, description, icon, actions, eyebrow,
}: { title: ReactNode; description?: ReactNode; icon?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between mb-6">
      <div>
        {eyebrow && <div className="text-xs uppercase tracking-[0.18em] text-primary/90 font-semibold mb-1.5">{eyebrow}</div>}
        <div className="flex items-center gap-3">
          {icon && <div className="h-10 w-10 grid place-items-center rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/30 text-primary">{icon}</div>}
          <h1 className="font-display text-2xl md:text-3xl font-bold tracking-tight">{title}</h1>
        </div>
        {description && <p className={cn("text-muted-foreground mt-2 max-w-2xl text-sm md:text-[15px]")}>{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function StatCard({ label, value, hint, accent = "primary", icon }: {
  label: string; value: ReactNode; hint?: ReactNode; icon?: ReactNode;
  accent?: "primary" | "ok" | "yellow" | "orange" | "red" | "break";
}) {
  const accentMap: Record<string, string> = {
    primary: "from-primary/25 to-primary/0 border-primary/30 text-primary",
    ok: "from-status-ok/25 to-status-ok/0 border-status-ok/30 text-status-ok",
    yellow: "from-status-yellow/25 to-status-yellow/0 border-status-yellow/30 text-status-yellow",
    orange: "from-status-orange/25 to-status-orange/0 border-status-orange/30 text-status-orange",
    red: "from-status-red/25 to-status-red/0 border-status-red/30 text-status-red",
    break: "from-status-break/25 to-status-break/0 border-status-break/30 text-status-break",
  };
  return (
    <div className="stat-card relative overflow-hidden">
      <div className={cn("absolute -top-10 -right-10 h-32 w-32 rounded-full bg-gradient-to-br blur-2xl opacity-60", accentMap[accent])} />
      <div className="flex items-start justify-between gap-3 relative">
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
          <div className="mt-1 text-3xl font-display font-bold tracking-tight">{value}</div>
          {hint && <div className="text-xs text-muted-foreground mt-1.5">{hint}</div>}
        </div>
        {icon && <div className={cn("h-9 w-9 grid place-items-center rounded-lg border bg-card", accentMap[accent])}>{icon}</div>}
      </div>
    </div>
  );
}
