import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import "@fontsource/space-grotesk/300.css";
import "@fontsource/space-grotesk/500.css";
import "@fontsource/space-grotesk/700.css";
import "@fontsource/dm-sans/400.css";
import "@fontsource/dm-sans/500.css";
import "@fontsource/dm-sans/700.css";
import { registerServiceWorker } from "./lib/sw-update";

// Initialize theme from localStorage before first paint
(() => {
  try {
    const saved = localStorage.getItem("coolguard-theme");
    const prefersLight = window.matchMedia("(prefers-color-scheme: light)").matches;
    const theme = saved ?? (prefersLight ? "light" : "dark");
    document.documentElement.classList.toggle("light", theme === "light");
  } catch {}
})();

createRoot(document.getElementById("root")!).render(<App />);

registerServiceWorker();
