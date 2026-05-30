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
      .then(([art, cats]) => {
        setArticle(art);
        setCategories(cats);
      })
      .catch(() => navigate('/'))
      .finally(() => setLoading(false));
  }, [slug, navigate]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
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
      <Link to="/" className="inline-flex items-center gap-1 text-sm text-gray-400 hover:text-indigo-600 mb-6">
        ← 一覧に戻る
      </Link>

      {imgUrl && (
        <div className="rounded-2xl overflow-hidden mb-8 shadow-lg">
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
        <h1 className="text-3xl font-bold text-gray-900 leading-tight flex-1">
          {showJa && article.title_ja ? article.title_ja : article.title}
        </h1>
        {article.title_ja && article.title_ja !== article.title && (
          <button
            onClick={() => setShowJa((v) => !v)}
            className="flex-shrink-0 text-xs border border-gray-200 text-gray-500 px-2 py-1 rounded hover:bg-gray-50 transition-colors mt-1"
          >
            {showJa ? 'EN' : 'JA'}
          </button>
        )}
      </div>

      <div className="flex items-center justify-between mb-6">
        <p className="text-sm text-gray-400">{date}</p>
        <div className="flex gap-2">
          <Link to={`/write?edit=${article.slug}`} className="text-xs text-gray-400 hover:text-indigo-600 transition-colors">編集</Link>
          <button onClick={handleDelete} className="text-xs text-gray-400 hover:text-red-500 transition-colors">削除</button>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 mb-8">
        {article.tags.map((tag) => (
          <Link key={tag} to={`/?tag=${encodeURIComponent(tag)}`} className="text-xs bg-gray-100 hover:bg-indigo-100 hover:text-indigo-700 text-gray-500 px-2 py-0.5 rounded transition-colors">
            #{tag}
          </Link>
        ))}
      </div>

      <div className="prose prose-gray max-w-none prose-img:rounded-lg prose-a:text-indigo-600 prose-headings:font-bold">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            img: ({ src, alt }) => {
              const fullSrc = src?.startsWith('http') ? src : `/static/articles/${article.slug}/${src}`;
              return <img src={fullSrc} alt={alt} className="rounded-lg shadow-md my-4 w-full" loading="lazy" />;
            },
          }}
        >
          {article.body}
        </ReactMarkdown>
      </div>

      {article.source_url && (
        <div className="mt-10 pt-6 border-t border-gray-100 text-xs text-gray-400">
          インポート元: <a href={article.source_url} target="_blank" rel="noopener noreferrer" className="hover:underline">{article.source_url}</a>
        </div>
      )}
    </article>
  );
}
