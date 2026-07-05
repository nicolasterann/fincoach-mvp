"use client";

import { useSyncExternalStore } from "react";

// O12 — light/dark switch. The no-flash script in the root layout sets
// document.documentElement.dataset.theme before paint; this reads that DOM
// attribute as an external store (no setState-in-effect) and flips it. All
// colors follow via the CSS-variable tokens in globals.css.
type Theme = "dark" | "light";

const THEME_EVENT = "kipu-theme-change";

function subscribe(callback: () => void) {
  window.addEventListener(THEME_EVENT, callback);
  window.addEventListener("storage", callback); // keep other tabs in sync
  return () => {
    window.removeEventListener(THEME_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

function getSnapshot(): Theme {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

function getServerSnapshot(): Theme {
  return "dark";
}

function setTheme(next: Theme) {
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem("kipu-theme", next);
  } catch {
    /* private mode / storage blocked — the in-memory switch still works */
  }
  window.dispatchEvent(new Event(THEME_EVENT));
}

const SunIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </svg>
);

const MoonIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
  </svg>
);

export function ThemeToggle({ className = "", showLabel = false }: { className?: string; showLabel?: boolean }) {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const toggle = () => setTheme(theme === "dark" ? "light" : "dark");
  const ariaLabel = theme === "dark" ? "Cambiar a modo claro" : "Cambiar a modo oscuro";

  // Labeled variant (Ajustes) — a pill that names the active theme and flips it.
  if (showLabel) {
    return (
      <button
        type="button"
        onClick={toggle}
        aria-label={ariaLabel}
        className={`kipu-press inline-flex shrink-0 items-center gap-2 rounded-full border border-line/15 px-3.5 py-2 text-sm font-semibold text-zinc-200 transition hover:border-line/30 ${className}`}
      >
        {theme === "dark" ? <MoonIcon /> : <SunIcon />}
        {theme === "dark" ? "Oscuro" : "Claro"}
      </button>
    );
  }

  // Icon-only variant (onboarding header, app chrome).
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={ariaLabel}
      title={theme === "dark" ? "Modo claro" : "Modo oscuro"}
      className={`kipu-press inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-line/15 text-zinc-400 transition hover:border-line/30 hover:text-zinc-200 ${className}`}
    >
      {theme === "dark" ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}
