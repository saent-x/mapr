import React, { lazy, Suspense } from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import './i18n'
import './index.css'
import { initTheme } from './utils/theme';
import { registerServiceWorker } from './services/serviceWorkerRegistration';
import Layout from './components/Layout.jsx'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import PageLoadingFallback from './components/PageLoadingFallback.jsx'

// Apply theme before first paint — system preference or stored choice.
initTheme();

// Register service worker for PWA offline support.
registerServiceWorker();

const HealthPage = lazy(() => import('./pages/HealthPage.jsx'))
const AdminPage = lazy(() => import('./pages/AdminPage.jsx'))
const EntityExplorerPage = lazy(() => import('./pages/EntityExplorerPage.jsx'))
const TrendAnalysisPage = lazy(() => import('./pages/TrendAnalysisPage.jsx'))
const IntelPage = lazy(() => import('./pages/IntelPage.jsx'))
const LoginPage = lazy(() => import('./pages/LoginPage.jsx'))
const HistoricalQueriesPage = lazy(() => import('./pages/HistoricalQueriesPage.jsx'))
const AccountPage = lazy(() => import('./pages/AccountPage.jsx'))
const EventDetailPage = lazy(() => import('./pages/EventDetailPage.jsx'))
const NotFoundPage = lazy(() => import('./pages/NotFoundPage.jsx'))
// RegionDetailPage was previously eagerly imported — lazy-loading it brings it
// in line with peer pages and shrinks the main entry chunk.
const RegionDetailPage = lazy(() => import('./pages/RegionDetailPage.jsx'))

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      {/* Top-level ErrorBoundary catches any render-throw inside a route so
          the app degrades to an error screen instead of a blank document. */}
      <ErrorBoundary>
        <Routes>
          <Route path="/health" element={<Suspense fallback={<PageLoadingFallback />}><HealthPage /></Suspense>} />
          <Route path="/login" element={<Suspense fallback={<PageLoadingFallback />}><LoginPage /></Suspense>} />
          <Route path="/signup" element={<Suspense fallback={<PageLoadingFallback />}><LoginPage /></Suspense>} />
          <Route path="/admin" element={<Suspense fallback={<PageLoadingFallback />}><AdminPage /></Suspense>} />
          <Route element={<Layout />}>
            <Route path="/" element={<App />} />
            <Route path="/region" element={<Suspense fallback={<PageLoadingFallback />}><RegionDetailPage /></Suspense>} />
            <Route path="/region/:iso" element={<Suspense fallback={<PageLoadingFallback />}><RegionDetailPage /></Suspense>} />
            <Route path="/historical" element={<Suspense fallback={<PageLoadingFallback />}><HistoricalQueriesPage /></Suspense>} />
            <Route path="/billing" element={<Navigate to="/account/billing" replace />} />
            <Route path="/account" element={<Suspense fallback={<PageLoadingFallback />}><AccountPage /></Suspense>} />
            <Route path="/account/billing" element={<Suspense fallback={<PageLoadingFallback />}><AccountPage /></Suspense>} />
            <Route path="/entities" element={<Suspense fallback={<PageLoadingFallback />}><EntityExplorerPage /></Suspense>} />
            <Route path="/trends" element={<Suspense fallback={<PageLoadingFallback />}><TrendAnalysisPage /></Suspense>} />
            <Route path="/intel" element={<Suspense fallback={<PageLoadingFallback />}><IntelPage /></Suspense>} />
            <Route path="/event/:id" element={<Suspense fallback={<PageLoadingFallback />}><EventDetailPage /></Suspense>} />
          </Route>
          {/* 404 fallback for any unknown path — without this, react-router
              renders nothing and the user sees a blank document. */}
          <Route path="*" element={<Suspense fallback={<PageLoadingFallback />}><NotFoundPage /></Suspense>} />
        </Routes>
      </ErrorBoundary>
    </BrowserRouter>
  </React.StrictMode>,
)
