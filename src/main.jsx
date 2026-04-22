import React, { lazy, Suspense } from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import './i18n'
import Layout from './components/Layout.jsx'
import App from './App.jsx'
import RegionDetailPage from './pages/RegionDetailPage.jsx'
import PageLoadingFallback from './components/PageLoadingFallback.jsx'
import './index.css'

const HealthPage = lazy(() => import('./pages/HealthPage.jsx'))
const AdminPage = lazy(() => import('./pages/AdminPage.jsx'))
const EntityExplorerPage = lazy(() => import('./pages/EntityExplorerPage.jsx'))
const TrendAnalysisPage = lazy(() => import('./pages/TrendAnalysisPage.jsx'))

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/health" element={<Suspense fallback={<PageLoadingFallback />}><HealthPage /></Suspense>} />
        <Route element={<Layout />}>
          <Route path="/" element={<App />} />
          <Route path="/region" element={<RegionDetailPage />} />
          <Route path="/region/:iso" element={<RegionDetailPage />} />
          <Route path="/admin" element={<Suspense fallback={<PageLoadingFallback />}><AdminPage /></Suspense>} />
          <Route path="/entities" element={<Suspense fallback={<PageLoadingFallback />}><EntityExplorerPage /></Suspense>} />
          <Route path="/trends" element={<Suspense fallback={<PageLoadingFallback />}><TrendAnalysisPage /></Suspense>} />
        </Route>
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
)
