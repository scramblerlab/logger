import { Link } from 'react-router-dom';
import type { Category, Tag } from '../types';

interface Props {
  categories: Category[];
  tags: Tag[];
  activeCategory: string | null;
  onSelectCategory: (slug: string | null) => void;
  onSelectTag: (tag: string) => void;
}

export default function Sidebar({ categories, tags, activeCategory, onSelectCategory, onSelectTag }: Props) {
  return (
    <aside className="w-64 flex-shrink-0 space-y-6">
      <div>
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">カテゴリー</h3>
        <ul className="space-y-1">
          <li>
            <button
              onClick={() => onSelectCategory(null)}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                !activeCategory ? 'bg-indigo-50 text-indigo-700 font-medium' : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              すべて / All
            </button>
          </li>
          {categories.map((cat) => (
            <li key={cat.slug}>
              <button
                onClick={() => onSelectCategory(cat.slug)}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm flex items-center gap-2 transition-colors ${
                  activeCategory === cat.slug ? 'bg-indigo-50 text-indigo-700 font-medium' : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: cat.color }} />
                <span>{cat.name_ja}</span>
                <span className="text-gray-400 ml-auto">{cat.name_en}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      {tags.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">タグ</h3>
          <div className="flex flex-wrap gap-1.5">
            {tags.slice(0, 30).map((tag) => (
              <button
                key={tag.slug}
                onClick={() => onSelectTag(tag.name)}
                className="text-xs bg-gray-100 hover:bg-indigo-100 hover:text-indigo-700 text-gray-600 px-2 py-0.5 rounded transition-colors"
              >
                #{tag.name}
                <span className="ml-1 text-gray-400">{tag.article_count}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="pt-4 border-t border-gray-100">
        <Link
          to="/import"
          className="flex items-center gap-2 text-sm text-gray-500 hover:text-indigo-600 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
          </svg>
          一括インポート
        </Link>
      </div>
    </aside>
  );
}
