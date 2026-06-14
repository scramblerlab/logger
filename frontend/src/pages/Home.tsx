import { useEffect, useState, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, heroImageUrl } from '../api/client';
import type { ArticleCard as ArticleCardType, Category, Tag } from '../types';
import ArticleCard from '../components/ArticleCard';
import Sidebar from '../components/Sidebar';
import CategoryEditModal from '../components/CategoryEditModal';
import BulkCategoryPanel from '../components/BulkCategoryPanel';
import ShopifyExportDialog from '../components/ShopifyExportDialog';
import ShopifyExportPanel from '../components/ShopifyExportPanel';
import { useAuth } from '../context/AuthContext';
import { useAiJob } from '../context/AiJobContext';
import { useTranslation } from '../context/TranslationContext';
import { usePushNotification } from '../hooks/usePushNotification';
import LoginModal from '../components/LoginModal';

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
  const [heroArticle, setHeroArticle] = useState<ArticleCardType | null>(null);
  const [translatedTitles, setTranslatedTitles] = useState<Map<string, string> | null>(null);
  const [translatedCategoryLabels, setTranslatedCategoryLabels] = useState<Map<string, string> | null>(null);
  const [translatedLabels, setTranslatedLabels] = useState<{ category: string; all: string; tag: string } | null>(null);
  const [showLogin, setShowLogin] = useState(false);

  const activeCategory = searchParams.get('category') ?? localStorage.getItem('activeCategory');
  const activeTag = searchParams.get('tag');
  const searchQuery = searchParams.get('q');
  const [sort, setSort] = useState<'published' | 'imported'>(
    () => (localStorage.getItem('articleSort') as 'published' | 'imported') ?? 'published'
  );

  const handleSetSort = (s: 'published' | 'imported') => {
    setSort(s);
    localStorage.setItem('articleSort', s);
  };
  const [bulkMode, setBulkMode] = useState(false);
  const [exportMode, setExportMode] = useState(false);
  const [showShopifyExportDialog, setShowShopifyExportDialog] = useState(false);
  const [shopifyCreds, setShopifyCreds] = useState<{ shopUrl: string; clientId: string; clientSecret: string; blogId: string; blogTitle: string } | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const loaderRef = useRef<HTMLDivElement>(null);
  const { isEditor, logout } = useAuth();
  const { setOnComplete, status: aiStatus, progress: aiProgress, startJob, commentStatus, commentProgress, startCommentJob } = useAiJob();
  const { registerHandlers } = useTranslation();
  const { supported: pushSupported, permission: pushPermission, subscribed: pushSubscribed, loading: pushLoading, subscribe: pushSubscribe, unsubscribe: pushUnsubscribe } = usePushNotification();

  useEffect(() => {
    api.articles.list({ page: 1, limit: 1, sort: 'published' }).then((data) => {
      if (data.items[0]?.hero_image) setHeroArticle(data.items[0]);
    }).catch(() => {});
  }, []);

  const reloadCategories = useCallback(() => {
    api.categories.list().then(setCategories).catch(() => {});
    api.categories.tags(50).then(setTags).catch(() => {});
  }, []);

  useEffect(() => { reloadCategories(); }, [reloadCategories]);

  const enterBulkMode = () => { setBulkMode(true); setSelectedIds(new Set()); };
  const exitBulkMode  = () => { setBulkMode(false); setSelectedIds(new Set()); };
  const enterExportMode = () => setShowShopifyExportDialog(true);
  const exitExportMode  = () => { setExportMode(false); setSelectedIds(new Set()); setShopifyCreds(null); };
  const handleExportConnected = (creds: typeof shopifyCreds) => {
    setShopifyCreds(creds);
    setShowShopifyExportDialog(false);
    setExportMode(true);
    setSelectedIds(new Set());
  };
  const toggleSelect  = (id: string) => setSelectedIds((prev) => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });
  const selectAll = () => {
    const visible = searchResults ?? articles;
    setSelectedIds(new Set(visible.map((a) => a.id)));
  };

  const handleBulkUpdate = async (add: string[], remove: string[]) => {
    const visible = searchResults ?? articles;
    const slugs = visible.filter((a) => selectedIds.has(a.id)).map((a) => a.slug);
    await api.articles.bulkCategorize(slugs, add, remove);
    exitBulkMode();
    loadArticles(true);
    reloadCategories();
  };

  const loadArticles = useCallback(async (reset = false) => {
    setLoading(true);
    const currentPage = reset ? 1 : page;
    try {
      const params: Record<string, string | number | undefined> = { page: currentPage, limit: PAGE_SIZE, sort };
      if (activeCategory) params.category = activeCategory;
      if (activeTag) params.tag = activeTag;
      const data = await api.articles.list(params);
      setTotal(data.total);
      if (reset) { setArticles(data.items); setPage(2); }
      else { setArticles((prev) => [...prev, ...data.items]); setPage((p) => p + 1); }
    } finally { setLoading(false); }
  }, [activeCategory, activeTag, page, sort]);

  useEffect(() => {
    if (searchQuery) {
      api.search.query(searchQuery).then(setSearchResults).catch(() => setSearchResults([]));
    } else {
      setSearchResults(null);
      loadArticles(true);
    }
  }, [activeCategory, activeTag, searchQuery, sort]);

  useEffect(() => {
    setOnComplete(() => {
      loadArticles(true);
      reloadCategories();
    });
  }, [setOnComplete, loadArticles, reloadCategories]);

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


  const displayedArticles = searchResults ?? articles;

  const displayedArticlesRef = useRef(displayedArticles);
  const categoriesRef = useRef(categories);
  useEffect(() => { displayedArticlesRef.current = displayedArticles; }, [displayedArticles]);
  useEffect(() => { categoriesRef.current = categories; }, [categories]);

  useEffect(() => {
    registerHandlers({
      onSelect: async (language) => {
        const arts = displayedArticlesRef.current;
        const cats = categoriesRef.current;
        const [titlesResult, catsResult, labelsResult] = await Promise.all([
          arts.length > 0
            ? api.translate.titles({ titles: arts.map((a) => a.title), target_language: language })
            : Promise.resolve({ titles: [] as string[] }),
          cats.length > 0
            ? api.translate.titles({ titles: cats.map((c) => c.name_ja), target_language: language })
            : Promise.resolve({ titles: [] as string[] }),
          api.translate.titles({ titles: ['カテゴリー', 'すべて', 'タグ'], target_language: language }),
        ]);
        setTranslatedTitles(new Map(arts.map((a, i) => [a.id, titlesResult.titles[i] ?? a.title])));
        setTranslatedCategoryLabels(new Map(cats.map((c, i) => [c.slug, catsResult.titles[i] ?? c.name_ja])));
        setTranslatedLabels({
          category: labelsResult.titles[0] ?? 'カテゴリー',
          all: labelsResult.titles[1] ?? 'すべて',
          tag: labelsResult.titles[2] ?? 'タグ',
        });
      },
      onReset: () => {
        setTranslatedTitles(null);
        setTranslatedCategoryLabels(null);
        setTranslatedLabels(null);
      },
    });
    return () => registerHandlers(null);
  }, [registerHandlers]);

  const finalArticles = translatedTitles
    ? displayedArticles.map((a) => ({ ...a, title: translatedTitles.get(a.id) ?? a.title }))
    : displayedArticles;

  useEffect(() => {
    const saved = localStorage.getItem('activeCategory');
    if (saved && !searchParams.get('category')) {
      const next = new URLSearchParams(searchParams);
      next.set('category', saved);
      setSearchParams(next, { replace: true });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSelectCategory = (slug: string | null) => {
    const next = new URLSearchParams(searchParams);
    if (slug) {
      next.set('category', slug);
      localStorage.setItem('activeCategory', slug);
    } else {
      next.delete('category');
      localStorage.removeItem('activeCategory');
    }
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
    <>
    {heroArticle && (
      <div className="relative h-[150px] overflow-hidden">
        <img
          src={heroImageUrl(heroArticle.slug, heroArticle.hero_image) ?? undefined}
          alt={heroArticle.title}
          className="w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-black/70" />
      </div>
    )}
    <div className={`max-w-7xl mx-auto px-4 py-8 ${bulkMode || exportMode ? 'pb-28' : ''}`}>
      {/* Mobile: action buttons (editor only) */}
      {isEditor && (
        <div className="flex flex-wrap gap-2 mb-3 lg:hidden">
          <button
            onClick={startJob}
            disabled={aiStatus === 'running'}
            className="btn btn-solid disabled:opacity-50"
          >
            {aiStatus === 'running' ? '⏳ AI中...' : 'AI分類'}
          </button>
          <button
            onClick={startCommentJob}
            disabled={commentStatus === 'running'}
            className="btn btn-solid disabled:opacity-50"
          >
            {commentStatus === 'running' ? '⏳ AIコメント中...' : 'AIコメント追加'}
          </button>
          <button
            onClick={() => setShowCategoryEdit(true)}
            className="btn btn-outline"
          >
            カテゴリー編集
          </button>
        </div>
      )}
      {isEditor && (aiStatus !== 'idle' || commentStatus !== 'idle') && (
        <div className="lg:hidden mb-2 space-y-0.5">
          {aiStatus !== 'idle' && aiProgress && <p className="text-xs text-amber-400">{aiProgress}</p>}
          {commentStatus !== 'idle' && commentProgress && <p className="text-xs text-amber-400">{commentProgress}</p>}
        </div>
      )}

      {/* Mobile: category tabs + auth */}
      <div className="lg:hidden mb-6">
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => handleSelectCategory(null)}
            className={`btn ${!activeCategory ? 'btn-solid' : 'btn-outline'}`}
          >
            {translatedLabels?.all ?? 'All'}
          </button>
          {categories.map((c) => (
            <button
              key={c.slug}
              onClick={() => handleSelectCategory(c.slug)}
              className={`btn ${activeCategory === c.slug ? 'text-white' : 'btn-outline'}`}
              style={activeCategory === c.slug ? { backgroundColor: c.color } : {}}
            >
              {translatedCategoryLabels?.get(c.slug) ?? c.name_ja}{c.article_count > 0 && <span className="ml-1 opacity-60">{c.article_count}</span>}
            </button>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-3">
          {isEditor ? (
            <button onClick={() => logout()} className="btn btn-solid">ログアウト</button>
          ) : (
            <button onClick={() => setShowLogin(true)} className="btn btn-solid">ログイン</button>
          )}
          {isEditor && pushSupported && pushPermission !== 'denied' && (
            <button
              onClick={pushSubscribed ? pushUnsubscribe : pushSubscribe}
              disabled={pushLoading}
              className="flex items-center gap-1.5 text-sm disabled:opacity-50 transition-colors"
              style={{ color: pushSubscribed ? '#f59e0b' : '#94a3b8' }}
            >
              <span>{pushSubscribed ? '🔔' : '🔕'}</span>
              <span>{pushLoading ? '...' : pushSubscribed ? 'AI通知 ON' : 'AI通知 OFF'}</span>
            </button>
          )}
        </div>
      </div>

      <div className="flex gap-8">
        <div className="hidden lg:block">
          <Sidebar
            categories={categories} tags={tags}
            activeCategory={activeCategory}
            onSelectCategory={handleSelectCategory}
            onSelectTag={handleSelectTag}
            onOpenCategoryEdit={() => setShowCategoryEdit(true)}
            onBulkCategorize={enterBulkMode}
            onShopifyExport={enterExportMode}
            categoryLabels={translatedCategoryLabels ?? undefined}
            labels={translatedLabels ?? undefined}
          />
        </div>

        <main className="flex-1 min-w-0">
          {!searchQuery && (
            <div className="flex items-center gap-1.5 mb-4">
              <button
                onClick={() => handleSetSort('published')}
                className={`btn ${sort === 'published' ? 'btn-solid' : 'btn-outline'}`}
              >
                新着順
              </button>
              <button
                onClick={() => handleSetSort('imported')}
                className={`btn ${sort === 'imported' ? 'btn-solid' : 'btn-outline'}`}
              >
                インポート順
              </button>
            </div>
          )}
          {searchQuery && (
            <div className="mb-4 flex items-center justify-between">
              <p className="text-sm text-slate-400">「{searchQuery}」の検索結果: {displayedArticles.length}件</p>
              <button onClick={() => setSearchParams({})} className="text-sm text-amber-400 hover:text-amber-300 transition-colors">クリア</button>
            </div>
          )}
          {activeTag && (
            <div className="mb-4 flex items-center gap-2">
              <span className="text-sm text-slate-400">タグ: #{activeTag}</span>
              <button onClick={() => { const n = new URLSearchParams(searchParams); n.delete('tag'); setSearchParams(n); }} className="text-xs text-slate-500 hover:text-red-400 transition-colors">×</button>
            </div>
          )}

          {finalArticles.length === 0 && !loading ? (
            <div className="text-center py-20 text-slate-500">
              <p className="text-lg">記事がありません</p>
              <p className="text-sm mt-2">Write a new article or import from an existing site</p>
            </div>
          ) : (
            <div className="flex flex-col gap-5">
              {finalArticles[0] && (
                <ArticleCard
                  key={finalArticles[0].id}
                  article={finalArticles[0]}
                  categories={categories}
                  featured={true}
                  selectable={bulkMode || exportMode}
                  selected={selectedIds.has(finalArticles[0].id)}
                  onSelect={toggleSelect}
                />
              )}
              {finalArticles.length > 1 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5">
                  {finalArticles.slice(1).map((article) => (
                    <ArticleCard
                      key={article.id}
                      article={article}
                      categories={categories}
                      selectable={bulkMode || exportMode}
                      selected={selectedIds.has(article.id)}
                      onSelect={toggleSelect}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          <div ref={loaderRef} className="h-10 flex items-center justify-center mt-6">
            {loading && <div className="w-6 h-6 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />}
          </div>
        </main>
      </div>

      {bulkMode && (
        <BulkCategoryPanel
          categories={categories}
          selectedCount={selectedIds.size}
          totalCount={displayedArticles.length}
          onSelectAll={selectAll}
          onClearSelection={() => setSelectedIds(new Set())}
          onUpdate={handleBulkUpdate}
          onCancel={exitBulkMode}
        />
      )}

      {showCategoryEdit && (
        <CategoryEditModal
          categories={categories}
          onClose={() => setShowCategoryEdit(false)}
          onCategoryAdded={(cat) => setCategories((prev) => [...prev, cat].sort((a, b) => a.name_en.localeCompare(b.name_en)))}
          onCategoryDeleted={(slug) => setCategories((prev) => prev.filter((c) => c.slug !== slug))}
        />
      )}

      {showShopifyExportDialog && (
        <ShopifyExportDialog
          onConfirm={handleExportConnected}
          onCancel={() => setShowShopifyExportDialog(false)}
        />
      )}

      {exportMode && shopifyCreds && (
        <ShopifyExportPanel
          selectedCount={selectedIds.size}
          totalCount={displayedArticles.length}
          shopUrl={shopifyCreds.shopUrl}
          blogId={shopifyCreds.blogId}
          clientId={shopifyCreds.clientId}
          clientSecret={shopifyCreds.clientSecret}
          selectedSlugs={(searchResults ?? articles).filter((a) => selectedIds.has(a.id)).map((a) => a.slug)}
          onSelectAll={selectAll}
          onClearSelection={() => setSelectedIds(new Set())}
          onDone={exitExportMode}
          onCancel={exitExportMode}
        />
      )}
    </div>
    {showLogin && <LoginModal onClose={() => setShowLogin(false)} />}
    </>
  );
}
