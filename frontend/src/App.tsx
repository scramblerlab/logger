import { Suspense, lazy, useEffect } from 'react';
import { BrowserRouter, Routes, Route, useNavigate } from 'react-router-dom';
import Header from './components/Header';
import Home from './pages/Home';
import ArticlePage from './pages/ArticlePage';
import { TranslationProvider } from './context/TranslationContext';

const WritePage = lazy(() => import('./pages/WritePage'));
const ImportPage = lazy(() => import('./pages/ImportPage'));
const ShopifyImportPage = lazy(() => import('./pages/ShopifyImportPage'));

function AppInner() {
  const navigate = useNavigate();

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
    }
  }, []);

  const handleSearch = (q: string) => {
    navigate(`/?q=${encodeURIComponent(q)}`);
  };

  return (
    <div className="min-h-screen bg-canvas overflow-x-hidden">
      <Header onSearch={handleSearch} />
      <Suspense fallback={null}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/articles/:slug" element={<ArticlePage />} />
          <Route path="/write" element={<WritePage />} />
          <Route path="/import" element={<ImportPage />} />
          <Route path="/import/shopify" element={<ShopifyImportPage />} />
        </Routes>
      </Suspense>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <TranslationProvider>
        <AppInner />
      </TranslationProvider>
    </BrowserRouter>
  );
}
