import { useEffect, useState, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import type { ArticleCard as ArticleCardType, Category, Tag } from '../types';
import ArticleCard from '../components/ArticleCard';
import Sidebar from '../components/Sidebar';
import CategoryEditModal from '../components/CategoryEditModal';

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
  const [showCategoryEdit, setShowCategoryEdit] = useState(false);
  const [aiStatus, setAiStatus] = useState<'idle' | 'running' | 'done'>('idle');
  const [aiProgress, setAiProgress] = useState('');

  const activeCategory = searchParams.get('category');
  const activeTag = searchParams.get('tag');
  const searchQuery = searchParams.get('q');
  const loaderRef = useRef<HTMLDivElement>(null);

  const reloadCategories = useCallback(() => {
    api.categories.list().then(setCategories).catch(() => {});
    api.categories.tags(50).then(setTags).catch(() => {});
  }, []);

  useEffect(() => { reloadCategories(); }, [reloadCategories]);

  const loadArticles = useCallback(async (reset = false) => {
    setLoading(true);
    const currentPage = reset ? 1 : page;
    try {
      const params: Record<string, string | number> = { page: currentPage, limit: PAGE_SIZE };
      if (activeCategory) params.category = activeCategory;
      if (activeTag) params.tag = activeTag;
      const data = await api.articles.list(params);
      setTotal(data.total);
      if (reset) { setArticles(data.items); setPage(2); }
      else { setArticles((prev) => [...prev, ...data.items]); setPage((p) => p + 1); }
    } finally { setLoading(false); }
  }, [activeCategory, activeTag, page]);

  useEffect(() => {
    if (searchQuery) {
      api.search.query(searchQuery).then(setSearchResults).catch(() => setSearchResults([]));
    } else {
      setSearchResults(null);
      loadArticles(true);
    }
  }, [activeCategory, activeTag, searchQuery]);

  useEffect(() => {
    const el = loaderRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => { if (entries[0].isIntersecting && !loading && articles.length < total && !searchResults) loadArticles(false); },
      { threshold: 0.1 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [loading, articles.length, total, searchResults, loadArticles]);

  const handleAiCategorize = async () => {
    setAiStatus('running');
    setAiProgress('AI分類を開始中...');
    try {
      const res = await api.articles.aiCategorize();
      if (!res.body) return;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          try {
            const evt = JSON.parse(line.slice(5).trim());
            if (evt.type === 'progress') {
              setAiProgress(`AI分類中... ${evt.done + 1}/${evt.total}`);
            } else if (evt.type === 'done') {
              const msg = evt.total === 0
                ? '未分類の記事はありません'
                : evt.failed > 0
                  ? `完了: ${evt.updated}/${evt.total}件を分類 (${evt.failed}件失敗)`
                  : `完了: ${evt.updated}/${evt.total}件を分類しました`;
              setAiProgress(msg);
              setAiStatus('done');
              loadArticles(true);
              reloadCategories();
            } else if (evt.type === 'error') {
              setAiProgress(`エラー: ${evt.message}`);
              setAiStatus('idle');
            }
          } catch { /* malformed line */ }
        }
      }
    } catch {
      setAiProgress('エラーが発生しました');
      setAiStatus('idle');
    }
  };

  const displayedArticles = searchResults ?? articles;

  const handleSelectCategory = (slug: string | null) => {
    const next = new URLSearchParams(searchParams);
    if (slug) next.set('category', slug); else next.delete('category');
    next.delete('tag'); next.delete('q');
    setSearchParams(next);
  };

  const handleSelectTag = (tag: string) => {
    const next = new URLSearchParams(searchParams);
    next.set('tag', tag);
    next.delete('category'); next.delete('q');
    setSearchParams(next);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      {/* Mobile: action buttons */}
      <div className="flex flex-wrap gap-2 mb-3 lg:hidden">
        <button
          onClick={handleAiCategorize}
          disabled={aiStatus === 'running'}
          className="text-xs px-3 py-1.5 rounded-lg bg-indigo-500 hover:bg-indigo-400 text-white font-medium disabled:opacity-50 transition-colors"
        >
          {aiStatus === 'running' ? '⏳ AI中...' : 'AI分類'}
        </button>
        <button
          onClick={() => setShowCategoryEdit(true)}
          className="text-xs px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 font-medium transition-colors"
        >
          カテゴリー編集
        </button>
        {aiStatus !== 'idle' && aiProgress && (
          <span className="text-xs text-indigo-400 self-center">{aiProgress}</span>
        )}
      </div>

      {/* Mobile: category tabs */}
      <div className="flex gap-2 overflow-x-auto pb-2 mb-6 lg:hidden">
        <button
          onClick={() => handleSelectCategory(null)}
          className={`flex-shrink-0 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
            !activeCategory ? 'bg-indigo-500 text-white' : 'bg-gray-800 text-gray-400 border border-gray-600 hover:bg-gray-700'
          }`}
        >
          All
        </button>
        {categories.map((c) => (
          <button
            key={c.slug}
            onClick={() => handleSelectCategory(c.slug)}
            className={`flex-shrink-0 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              activeCategory === c.slug ? 'text-white' : 'bg-gray-800 text-gray-400 border border-gray-600 hover:bg-gray-700'
            }`}
            style={activeCategory === c.slug ? { backgroundColor: c.color } : {}}
          >
            {c.name_ja}{c.article_count > 0 && <span className="ml-1 opacity-60 text-xs">{c.article_count}</span>}
          </button>
        ))}
      </div>

      <div className="flex gap-8">
        <div className="hidden lg:block">
          <Sidebar
            categories={categories} tags={tags}
            activeCategory={activeCategory}
            onSelectCategory={handleSelectCategory}
            onSelectTag={handleSelectTag}
            aiCategorizeStatus={aiStatus}
            aiCategorizeProgress={aiProgress}
            onAiCategorize={handleAiCategorize}
            onOpenCategoryEdit={() => setShowCategoryEdit(true)}
          />
        </div>

        <main className="flex-1 min-w-0">
          {searchQuery && (
            <div className="mb-4 flex items-center justify-between">
              <p className="text-sm text-gray-400">「{searchQuery}」の検索結果: {displayedArticles.length}件</p>
              <button onClick={() => setSearchParams({})} className="text-sm text-indigo-400 hover:text-indigo-300 transition-colors">クリア</button>
            </div>
          )}
          {activeTag && (
            <div className="mb-4 flex items-center gap-2">
              <span className="text-sm text-gray-400">タグ: #{activeTag}</span>
              <button onClick={() => { const n = new URLSearchParams(searchParams); n.delete('tag'); setSearchParams(n); }} className="text-xs text-gray-500 hover:text-red-400 transition-colors">×</button>
            </div>
          )}

          {displayedArticles.length === 0 && !loading ? (
            <div className="text-center py-20 text-gray-600">
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
            {loading && <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />}
          </div>
        </main>
      </div>

      {showCategoryEdit && (
        <CategoryEditModal
          categories={categories}
          onClose={() => setShowCategoryEdit(false)}
          onCategoryAdded={(cat) => setCategories((prev) => [...prev, cat].sort((a, b) => a.name_en.localeCompare(b.name_en)))}
          onCategoryDeleted={(slug) => setCategories((prev) => prev.filter((c) => c.slug !== slug))}
        />
      )}
    </div>
  );
}
