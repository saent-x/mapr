import { lazy, Suspense } from "react";
import { Routes, Route } from "react-router-dom";
import Shell from "./components/Shell.jsx";
import MapPage from "./pages/MapPage.jsx";

// Secondary surfaces are lazy-loaded so the landing (map) chunk stays lean.
const IntelPage = lazy(() => import("./pages/IntelPage.jsx"));
const TrendAnalysisPage = lazy(() => import("./pages/TrendAnalysisPage.jsx"));
const EntityExplorerPage = lazy(() => import("./pages/EntityExplorerPage.jsx"));
const WorkspacePage = lazy(() => import("./pages/WorkspacePage.jsx"));
const RegionDetailPage = lazy(() => import("./pages/RegionDetailPage.jsx"));
const EventDetailPage = lazy(() => import("./pages/EventDetailPage.jsx"));
const AccountPage = lazy(() => import("./pages/AccountPage.jsx"));
const AdminPage = lazy(() => import("./pages/AdminPage.jsx"));

function Loading() {
  return <div className="page"><div className="page-narrow"><div className="card mono">Loading…</div></div></div>;
}

export default function App() {
  return (
    <Shell>
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="/" element={<MapPage />} />
          <Route path="/intel" element={<IntelPage />} />
          <Route path="/trends" element={<TrendAnalysisPage />} />
          <Route path="/entities" element={<EntityExplorerPage />} />
          <Route path="/workspace" element={<WorkspacePage />} />
          <Route path="/region/:iso" element={<RegionDetailPage />} />
          <Route path="/event/:id" element={<EventDetailPage />} />
          <Route path="/account" element={<AccountPage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="*" element={<MapPage />} />
        </Routes>
      </Suspense>
    </Shell>
  );
}
