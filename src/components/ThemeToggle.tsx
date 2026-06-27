import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";

type Theme = "light" | "dark";
const KEY = "coolguard-theme";

function getInitial(): Theme {
  if (typeof window === "undefined") return "dark";
  const saved = localStorage.getItem(KEY) as Theme | null;
  if (saved === "light" || saved === "dark") return saved;
  return document.documentElement.classList.contains("light") ? "light" : "dark";
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(getInitial);

  useEffect(() => {
    document.documentElement.classList.toggle("light", theme === "light");
    try { localStorage.setItem(KEY, theme); } catch {}
  }, [theme]);

  const next: Theme = theme === "light" ? "dark" : "light";
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setTheme(next)}
      aria-label={`Mudar para tema ${next === "light" ? "claro" : "escuro"}`}
      title={`Tema ${theme === "light" ? "claro" : "escuro"}`}
      className="relative h-9 w-9 rounded-full border border-border/60 hover:border-primary/50 hover:bg-primary/5 transition-colors"
    >
      <Sun className="h-4 w-4 rotate-0 scale-100 transition-all duration-300 dark:-rotate-90 dark:scale-0 light:rotate-0 light:scale-100" style={{ display: theme === "light" ? "block" : "none" }} />
      <Moon className="h-4 w-4 transition-all duration-300" style={{ display: theme === "dark" ? "block" : "none" }} />
    </Button>
  );
}
