import { Link } from 'react-router-dom';
import type { ArticleCard as ArticleCardType } from '../types';
import { heroImageUrl } from '../api/client';

interface Props {
  article: ArticleCardType;
  categories: { slug: string; name_en: string; name_ja: string; color: string }[];
}

export default function ArticleCard({ article, categories }: Props) {
  const imgUrl = heroImageUrl(article.slug, article.hero_image);
  const cats = categories.filter((c) => article.categories.includes(c.slug));
  const date = article.published_at
    ? new Date(article.published_at).toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' })
    : '';

  return (
    <Link to={`/articles/${article.slug}`} className="group block bg-gray-800 rounded-xl overflow-hidden ring-1 ring-gray-700 hover:ring-indigo-500/50 transition-all duration-200">
      <div className="relative aspect-video bg-gray-700 overflow-hidden">
        {imgUrl ? (
          <img
            src={imgUrl}
            alt={article.title}
            loading="lazy"
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-600">
            <svg className="w-16 h-16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
        )}
      </div>
      <div className="p-4">
        <div className="flex flex-wrap gap-1 mb-2">
          {cats.map((c) => (
            <span key={c.slug} className="text-xs font-medium px-2 py-0.5 rounded-full text-white" style={{ backgroundColor: c.color }}>
              {c.name_ja}
            </span>
          ))}
        </div>
        <h3 className="font-bold text-gray-100 line-clamp-2 leading-snug mb-1 group-hover:text-indigo-300 transition-colors">
          {article.title}
        </h3>
        {article.title_ja && article.title_ja !== article.title && (
          <p className="text-sm text-gray-500 line-clamp-1 mb-2">{article.title_ja}</p>
        )}
        <div className="flex flex-wrap gap-1 mt-2">
          {article.tags.slice(0, 4).map((tag) => (
            <span key={tag} className="text-xs text-gray-500 bg-gray-700 px-1.5 py-0.5 rounded">#{tag}</span>
          ))}
        </div>
        {date && <p className="text-xs text-gray-600 mt-3">{date}</p>}
      </div>
    </Link>
  );
}
