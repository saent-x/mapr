import { lazy, Suspense } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import Console from "./sw/Console.jsx";

// The Console (map + composer watchdesk) is the landing surface and stays eager.
// The standalone surfaces are lazy-loaded so the console chunk stays lean.
const AuthPage = lazy(() => import("./sw/AuthPage.jsx"));
const AccountPage = lazy(() => import("./sw/AccountPage.jsx"));
const AdminPage = lazy(() => import("./sw/AdminPage.jsx"));

function Loading() {
  return (
    <div className="cold">
      <div className="cold-card">
        <span className="eyebrow">mapr · standing watch · live</span>
        <h1 className="serif">Loading…</h1>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route path="/" element={<Console />} />
        <Route path="/signin" element={<AuthPage />} />
        <Route path="/account" element={<AccountPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
