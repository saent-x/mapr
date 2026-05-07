import React, { lazy, Suspense } from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import './i18n'
import './index.css'
import { initTheme } from './utils/theme';
import { registerServiceWorker } from './services/serviceWorkerRegistration';
import Layout from './components/Layout.jsx'
import App from './App.jsx'
import RegionDetailPage from './pages/RegionDetailPage.jsx'
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
const BillingPage = lazy(() => import('./pages/BillingPage.jsx'))
const EventDetailPage = lazy(() => import('./pages/EventDetailPage.jsx'))

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/health" element={<Suspense fallback={<PageLoadingFallback />}><HealthPage /></Suspense>} />
        <Route path="/login" element={<Suspense fallback={<PageLoadingFallback />}><LoginPage /></Suspense>} />
        <Route element={<Layout />}>
          <Route path="/" element={<App />} />
          <Route path="/region" element={<RegionDetailPage />} />
          <Route path="/region/:iso" element={<RegionDetailPage />} />
          <Route path="/historical" element={<Suspense fallback={<PageLoadingFallback />}><HistoricalQueriesPage /></Suspense>} />
          <Route path="/billing" element={<Suspense fallback={<PageLoadingFallback />}><BillingPage /></Suspense>} />
          <Route path="/admin" element={<Suspense fallback={<PageLoadingFallback />}><AdminPage /></Suspense>} />
          <Route path="/entities" element={<Suspense fallback={<PageLoadingFallback />}><EntityExplorerPage /></Suspense>} />
          <Route path="/trends" element={<Suspense fallback={<PageLoadingFallback />}><TrendAnalysisPage /></Suspense>} />
          <Route path="/intel" element={<Suspense fallback={<PageLoadingFallback />}><IntelPage /></Suspense>} />
          <Route path="/event/:id" element={<Suspense fallback={<PageLoadingFallback />}><EventDetailPage /></Suspense>} />
        </Route>
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
)
