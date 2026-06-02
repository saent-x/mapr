import { useState, useEffect } from "react";

// App-wide light/dark theme. Persisted; applied as `html.theme-light`. The map
// subscribes via useTheme() to swap the basemap + overlay colors.
const KEY = "mapr-theme";
const listeners = new Set();

function initial() {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    /* ignore */
  }
  return "dark"; // tactical default; toggle (persisted) switches to light
}

let current = initial();

function apply(t) {
  if (typeof document !== "undefined") {
    document.documentElement.classList.toggle("theme-light", t === "light");
    document.documentElement.style.colorScheme = t;
  }
}
apply(current);

export function getTheme() {
  return current;
}

export function setTheme(t) {
  if (t !== "light" && t !== "dark") return;
  current = t;
  try {
    localStorage.setItem(KEY, t);
  } catch {
    /* ignore */
  }
  apply(t);
  for (const l of listeners) l(t);
}

export function toggleTheme() {
  setTheme(current === "light" ? "dark" : "light");
}

export function useTheme() {
  const [t, setT] = useState(current);
  useEffect(() => {
    const l = (x) => setT(x);
    listeners.add(l);
    setT(current);
    return () => listeners.delete(l);
  }, []);
  return t;
}
