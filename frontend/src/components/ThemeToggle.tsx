"use client";

import { useSyncExternalStore } from "react";

type Theme = "light" | "dark";
const STORAGE_KEY = "theme";
const CHANGE_EVENT = "themechange";

function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
  document.documentElement.style.colorScheme = theme;
}

function resolveTheme(): Theme {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === "light" || saved === "dark") return saved;
  if (document.documentElement.classList.contains("dark")) return "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function subscribe(onStoreChange: () => void) {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  window.addEventListener(CHANGE_EVENT, onStoreChange);
  media.addEventListener("change", onStoreChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onStoreChange);
    media.removeEventListener("change", onStoreChange);
  };
}

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, resolveTheme, () => "light");
  const isDark = theme === "dark";

  function toggleTheme() {
    const next = isDark ? "light" : "dark";
    localStorage.setItem(STORAGE_KEY, next);
    applyTheme(next);
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={`Switch to ${isDark ? "light" : "dark"} mode`}
      className="btn btn-sm btn-ghost"
    >
      <span aria-hidden="true">{isDark ? "☾" : "☀"}</span>
    </button>
  );
}
