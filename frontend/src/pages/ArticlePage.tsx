import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api, heroImageUrl } from '../api/client';
import type { Article, Category } from '../types';
import { useAuth } from '../context/AuthContext';

export default function ArticlePage() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { isEditor } = useAuth();
  const [article, setArticle] = useState<Article | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
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

  const imgUrl = heroImageUrl(article.slug, article.hero_image, article.updated_at);
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
      {/* Action buttons — fixed below header, top-right (editor only) */}
      {isEditor && (
        <div className="fixed top-[72px] right-4 z-30 flex gap-2">
          <Link
            to={`/write?edit=${article.slug}`}
            className="text-xs px-2.5 py-1 rounded-full bg-amber-500 hover:bg-amber-400 text-black font-semibold shadow-lg transition-colors whitespace-nowrap"
          >
            編集
          </Link>
          <button
            onClick={handleDelete}
            className="text-xs px-2.5 py-1 rounded-full bg-surface2 hover:bg-red-600 border border-rim hover:border-red-600 text-slate-300 hover:text-white font-semibold shadow-lg transition-colors whitespace-nowrap"
          >
            削除
          </button>
        </div>
      )}

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

      <h1 className="text-3xl font-bold text-slate-100 leading-tight mb-2">
        {article.title}
      </h1>

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
