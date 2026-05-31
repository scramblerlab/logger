import { BrowserRouter, Routes, Route, useNavigate } from 'react-router-dom';
import Header from './components/Header';
import Home from './pages/Home';
import ArticlePage from './pages/ArticlePage';
import WritePage from './pages/WritePage';
import ImportPage from './pages/ImportPage';
import ShopifyImportPage from './pages/ShopifyImportPage';

function AppInner() {
  const navigate = useNavigate();

  const handleSearch = (q: string) => {
    navigate(`/?q=${encodeURIComponent(q)}`);
  };

  return (
    <div className="min-h-screen bg-canvas">
      <Header onSearch={handleSearch} />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/articles/:slug" element={<ArticlePage />} />
        <Route path="/write" element={<WritePage />} />
        <Route path="/import" element={<ImportPage />} />
        <Route path="/import/shopify" element={<ShopifyImportPage />} />
      </Routes>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppInner />
    </BrowserRouter>
  );
}
