// Minimal classnames helper for the vendored mapcn component (replaces the
// shadcn `cn`/clsx+tailwind-merge dependency). Supports strings, numbers,
// arrays, and conditional objects — all mapcn needs.
export function cn(...inputs) {
  const out = [];
  const walk = (x) => {
    if (!x) return;
    if (typeof x === "string" || typeof x === "number") out.push(String(x));
    else if (Array.isArray(x)) x.forEach(walk);
    else if (typeof x === "object") for (const k in x) if (x[k]) out.push(k);
  };
  inputs.forEach(walk);
  return out.join(" ");
}
