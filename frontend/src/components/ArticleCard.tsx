import { Link } from 'react-router-dom';
import type { ArticleCard as ArticleCardType } from '../types';
import { heroImageUrl } from '../api/client';

interface Props {
  article: ArticleCardType;
  categories: { slug: string; name_en: string; name_ja: string; color: string }[];
  selectable?: boolean;
  selected?: boolean;
  onSelect?: (id: string) => void;
  featured?: boolean;
}

export default function ArticleCard({ article, categories, selectable, selected, onSelect, featured }: Props) {
  const imgUrl = heroImageUrl(article.slug, article.hero_image, article.updated_at);
  const cats = categories.filter((c) => article.categories.includes(c.slug));
  const date = article.published_at
    ? new Date(article.published_at).toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' })
    : '';

  const placeholder = (
    <div className="w-full h-full flex items-center justify-center text-slate-600">
      <svg className="w-16 h-16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
    </div>
  );

  const checkbox = selectable && (
    <div className={`absolute top-2 left-2 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${selected ? 'bg-amber-500 border-amber-500' : 'bg-black/40 border-white/60'}`}>
      {selected && (
        <svg className="w-3 h-3 text-black" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
        </svg>
      )}
    </div>
  );

  const content = (
    <div className={`p-4 ${featured ? 'flex flex-col justify-center flex-1 min-w-0' : 'flex flex-col justify-center flex-1 min-w-0 sm:block'}`}>
      <div className="flex flex-wrap gap-1 mb-2">
        {cats.map((c) => (
          <span key={c.slug} className="text-xs font-medium px-2 py-0.5 rounded-full text-white" style={{ backgroundColor: c.color }}>
            {c.name_ja}
          </span>
        ))}
      </div>
      <h3 className="font-bold text-slate-100 line-clamp-2 leading-snug mb-1 group-hover:text-amber-400 transition-colors">
        {article.title}
      </h3>
      <div className="flex flex-wrap gap-1 mt-2">
        {article.tags.slice(0, 4).map((tag) => (
          <span key={tag} className="text-xs text-slate-500 bg-surface2 px-1.5 py-0.5 rounded">#{tag}</span>
        ))}
      </div>
      {date && <p className="text-xs text-slate-500 mt-3">{date}</p>}
    </div>
  );

  const inner = featured ? (
    <>
      <div className="relative w-2/5 flex-shrink-0 bg-surface2 overflow-hidden">
        {imgUrl ? (
          <img src={imgUrl} alt={article.title} loading="lazy" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
        ) : placeholder}
        {checkbox}
      </div>
      {content}
    </>
  ) : (
    <>
      <div className="relative w-2/5 flex-shrink-0 sm:w-full sm:aspect-video bg-surface2 overflow-hidden">
        {imgUrl ? (
          <img src={imgUrl} alt={article.title} loading="lazy" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
        ) : placeholder}
        {checkbox}
      </div>
      {content}
    </>
  );

  const baseClass = `group bg-surface rounded-xl overflow-hidden ring-1 ring-rim hover:ring-amber-500/50 transition-all duration-200 ${featured ? 'flex flex-row' : 'flex flex-row sm:block'}`;

  if (selectable) {
    return (
      <div
        onClick={() => onSelect?.(article.id)}
        className={`${baseClass} cursor-pointer ${selected ? 'ring-amber-500 ring-2' : ''}`}
      >
        {inner}
      </div>
    );
  }

  return (
    <Link to={`/articles/${article.slug}`} className={baseClass}>
      {inner}
    </Link>
  );
}
