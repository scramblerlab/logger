import { useEffect, useState, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import type { ArticleCard as ArticleCardType, Category, Tag } from '../types';
import ArticleCard from '../components/ArticleCard';
import Sidebar from '../components/Sidebar';

const PAGE_SIZE = 18;

export default function Home() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [articles, setArticles] = useState<ArticleCardType[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [searchResults, setSearchResults] = useState<ArticleCardType[] | null>(null);

  const activeCategory = searchParams.get('category');
  const activeTag = searchParams.get('tag');
  const searchQuery = searchParams.get('q');
  const loaderRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.categories.list().then(setCategories).catch(() => {});
    api.categories.tags(50).then(setTags).catch(() => {});
  }, []);

  const loadArticles = useCallback(async (reset = false) => {
    setLoading(true);
    const currentPage = reset ? 1 : page;
    try {
      const params: Record<string, string | number> = { page: currentPage, limit: PAGE_SIZE };
      if (activeCategory) params.category = activeCategory;
      if (activeTag) params.tag = activeTag;
      const data = await api.articles.list(params);
      setTotal(data.total);
      if (reset) {
        setArticles(data.items);
        setPage(2);
      } else {
        setArticles((prev) => [...prev, ...data.items]);
        setPage((p) => p + 1);
      }
    } finally {
      setLoading(false);
    }
  }, [activeCategory, activeTag, page]);

  useEffect(() => {
    if (searchQuery) {
      api.search.query(searchQuery).then(setSearchResults).catch(() => setSearchResults([]));
    } else {
      setSearchResults(null);
      loadArticles(true);
    }
  }, [activeCategory, activeTag, searchQuery]);

  // Infinite scroll
  useEffect(() => {
    const el = loaderRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !loading && articles.length < total && !searchResults) {
          loadArticles(false);
        }
      },
      { threshold: 0.1 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [loading, articles.length, total, searchResults, loadArticles]);

  const displayedArticles = searchResults ?? articles;

  const handleSelectCategory = (slug: string | null) => {
    const next = new URLSearchParams(searchParams);
    if (slug) next.set('category', slug); else next.delete('category');
    next.delete('tag');
    next.delete('q');
    setSearchParams(next);
  };

  const handleSelectTag = (tag: string) => {
    const next = new URLSearchParams(searchParams);
    next.set('tag', tag);
    next.delete('category');
    next.delete('q');
    setSearchParams(next);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      {/* Category tabs (mobile) */}
      <div className="flex gap-2 overflow-x-auto pb-2 mb-6 lg:hidden">
        <button
          onClick={() => handleSelectCategory(null)}
          className={`flex-shrink-0 px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
            !activeCategory ? 'bg-indigo-600 text-white border-indigo-600' : 'border-gray-200 text-gray-600 hover:bg-gray-50'
          }`}
        >
          All
        </button>
        {categories.map((c) => (
          <button
            key={c.slug}
            onClick={() => handleSelectCategory(c.slug)}
            className={`flex-shrink-0 px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
              activeCategory === c.slug ? 'text-white border-transparent' : 'border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
            style={activeCategory === c.slug ? { backgroundColor: c.color, borderColor: c.color } : {}}
          >
            {c.name_ja}
          </button>
        ))}
      </div>

      <div className="flex gap-8">
        {/* Sidebar (desktop) */}
        <div className="hidden lg:block">
          <Sidebar
            categories={categories}
            tags={tags}
            activeCategory={activeCategory}
            onSelectCategory={handleSelectCategory}
            onSelectTag={handleSelectTag}
          />
        </div>

        {/* Main content */}
        <main className="flex-1 min-w-0">
          {searchQuery && (
            <div className="mb-4 flex items-center justify-between">
              <p className="text-sm text-gray-500">
                「{searchQuery}」の検索結果: {displayedArticles.length}件
              </p>
              <button
                onClick={() => { setSearchParams({}); }}
                className="text-sm text-indigo-600 hover:underline"
              >
                クリア
              </button>
            </div>
          )}
          {activeTag && (
            <div className="mb-4 flex items-center gap-2">
              <span className="text-sm text-gray-500">タグ: #{activeTag}</span>
              <button onClick={() => { const n = new URLSearchParams(searchParams); n.delete('tag'); setSearchParams(n); }} className="text-xs text-gray-400 hover:text-red-500">×</button>
            </div>
          )}

          {displayedArticles.length === 0 && !loading ? (
            <div className="text-center py-20 text-gray-400">
              <p className="text-lg">記事がありません</p>
              <p className="text-sm mt-2">Write a new article or import from an existing site</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5">
              {displayedArticles.map((article) => (
                <ArticleCard key={article.id} article={article} categories={categories} />
              ))}
            </div>
          )}

          <div ref={loaderRef} className="h-10 flex items-center justify-center mt-6">
            {loading && (
              <div className="w-6 h-6 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
