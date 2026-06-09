import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ConvexReactClient } from "convex/react";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { BrowserRouter } from "react-router-dom";
import App from "./App.jsx";

// Tailwind v4 utilities (no preflight) — powers the mapcn map chrome only.
import "./sw/map/tailwind.css";
// "The Standing Watch" design system — ink + severity-only color, goldenrod accent.
import "./sw/styles.css";
import "./sw/components.css";
import "./sw/components2.css";
import "./sw/features.css";
import "./sw/pages.css";
import "./sw/auth.css";
// MapLibre/mapcn marker visuals (severity dots, hover tips).
import "./sw/map.css";

// Convex stays wired for backend/auth; the redesigned surfaces render without it
// when no instance URL is configured, so the console boots on its own.
const url = import.meta.env.VITE_CONVEX_URL;
const convex = url ? new ConvexReactClient(url) : null;

function Root() {
  const tree = (
    <BrowserRouter>
      <App />
    </BrowserRouter>
  );
  return convex ? <ConvexAuthProvider client={convex}>{tree}</ConvexAuthProvider> : tree;
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
