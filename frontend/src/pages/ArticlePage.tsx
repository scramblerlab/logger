import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api, heroImageUrl } from '../api/client';
import type { Article, Category } from '../types';

export default function ArticlePage() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const [article, setArticle] = useState<Article | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [showJa, setShowJa] = useState(false);

  useEffect(() => {
    if (!slug) return;
    Promise.all([api.articles.get(slug), api.categories.list()])
      .then(([art, cats]) => { setArticle(art); setCategories(cats); })
      .catch(() => navigate('/'))
      .finally(() => setLoading(false));
  }, [slug, navigate]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  if (!article) return null;

  const imgUrl = heroImageUrl(article.slug, article.hero_image);
  const articleCats = categories.filter((c) => article.categories.includes(c.slug));
  const date = article.published_at
    ? new Date(article.published_at).toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' })
    : '';

  const handleDelete = async () => {
    if (!confirm('この記事を削除しますか？')) return;
    await api.articles.delete(article.slug);
    navigate('/');
  };

  return (
    <article className="max-w-3xl mx-auto px-4 py-10">
      {/* Action buttons — fixed below header, top-right */}
      <div className="fixed top-[72px] right-4 z-30 flex gap-2">
        <Link
          to={`/write?edit=${article.slug}`}
          className="inline-flex items-center gap-1.5 bg-amber-500 hover:bg-amber-400 text-black text-sm font-semibold px-4 py-2 rounded-full shadow-lg transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          </svg>
          編集
        </Link>
        <button
          onClick={handleDelete}
          className="inline-flex items-center gap-1.5 bg-surface2 hover:bg-red-600 border border-rim hover:border-red-600 text-slate-300 hover:text-white text-sm font-semibold px-4 py-2 rounded-full shadow-lg transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
          削除
        </button>
      </div>

      <Link to="/" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-amber-400 mb-6 transition-colors">
        ← 一覧に戻る
      </Link>

      {imgUrl && (
        <div className="rounded-2xl overflow-hidden mb-8 shadow-2xl">
          <img src={imgUrl} alt={article.title} className="w-full object-cover max-h-96" />
        </div>
      )}

      <div className="flex flex-wrap gap-2 mb-4">
        {articleCats.map((c) => (
          <span key={c.slug} className="text-sm font-medium px-3 py-1 rounded-full text-white" style={{ backgroundColor: c.color }}>
            {c.name_ja} / {c.name_en}
          </span>
        ))}
      </div>

      <div className="flex items-start justify-between gap-4 mb-2">
        <h1 className="text-3xl font-bold text-slate-100 leading-tight flex-1">
          {showJa && article.title_ja ? article.title_ja : article.title}
        </h1>
        {article.title_ja && article.title_ja !== article.title && (
          <button
            onClick={() => setShowJa((v) => !v)}
            className="flex-shrink-0 text-xs bg-surface2 hover:bg-rim border border-rim text-slate-400 px-2 py-1 rounded-lg transition-colors mt-1"
          >
            {showJa ? 'EN' : 'JA'}
          </button>
        )}
      </div>

      {date && <p className="text-sm text-slate-500 mb-6">{date}</p>}

      <div className="flex flex-wrap gap-1.5 mb-8">
        {article.tags.map((tag) => (
          <Link key={tag} to={`/?tag=${encodeURIComponent(tag)}`}
            className="text-xs bg-surface2 hover:bg-amber-500/30 hover:text-amber-400 text-slate-400 px-2 py-0.5 rounded transition-colors"
          >
            #{tag}
          </Link>
        ))}
      </div>

      <div className="prose prose-invert max-w-none prose-a:text-amber-400 prose-img:rounded-xl prose-code:text-amber-300 prose-pre:bg-surface2">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            img: ({ src, alt }) => {
              const fullSrc =
                src?.startsWith('http') || src?.startsWith('/')
                  ? src
                  : `/static/articles/${article.slug}/${src}`;
              return <img src={fullSrc} alt={alt} className="rounded-xl shadow-lg my-4 w-full" loading="lazy" />;
            },
          }}
        >
          {article.body}
        </ReactMarkdown>
      </div>

      {article.source_url && (
        <div className="mt-10 pt-6 border-t border-rim text-xs text-slate-500">
          インポート元: <a href={article.source_url} target="_blank" rel="noopener noreferrer" className="hover:text-slate-300 hover:underline transition-colors">{article.source_url}</a>
        </div>
      )}
    </article>
  );
}
