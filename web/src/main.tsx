import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';

import './index.css';
import Landing from './pages/Landing';

// The app pulls in the Midnight SDK and its wasm; the landing page should not.
const AppPage = lazy(() => import('./pages/AppPage'));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route
          path="/app"
          element={
            <Suspense fallback={<main className="min-h-[100dvh]" aria-busy="true" />}>
              <AppPage />
            </Suspense>
          }
        />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
