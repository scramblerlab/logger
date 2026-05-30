import { Link } from 'react-router-dom';
import type { Category, Tag } from '../types';

interface Props {
  categories: Category[];
  tags: Tag[];
  activeCategory: string | null;
  onSelectCategory: (slug: string | null) => void;
  onSelectTag: (tag: string) => void;
  aiCategorizeStatus: 'idle' | 'running' | 'done';
  aiCategorizeProgress: string;
  onAiCategorize: () => void;
  onOpenCategoryEdit: () => void;
}

export default function Sidebar({
  categories, tags, activeCategory,
  onSelectCategory, onSelectTag,
  aiCategorizeStatus, aiCategorizeProgress,
  onAiCategorize, onOpenCategoryEdit,
}: Props) {
  return (
    <aside className="w-64 flex-shrink-0 space-y-6">
      <div>
        {/* Category header */}
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">カテゴリー</h3>
          <div className="flex items-center gap-1.5">
            <button
              onClick={onAiCategorize}
              disabled={aiCategorizeStatus === 'running'}
              title="AI カテゴライズ"
              className="text-xs px-2.5 py-1 rounded-lg bg-indigo-500 hover:bg-indigo-400 disabled:opacity-50 text-white font-medium transition-colors whitespace-nowrap"
            >
              {aiCategorizeStatus === 'running' ? '⏳ AI中...' : 'AI分類'}
            </button>
            <button
              onClick={onOpenCategoryEdit}
              title="カテゴリーを編集"
              className="text-xs px-2.5 py-1 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 font-medium transition-colors"
            >
              編集
            </button>
          </div>
        </div>

        {/* AI progress */}
        {aiCategorizeStatus !== 'idle' && aiCategorizeProgress && (
          <p className="text-xs text-indigo-400 mb-2">{aiCategorizeProgress}</p>
        )}

        <ul className="space-y-0.5">
          <li>
            <button
              onClick={() => onSelectCategory(null)}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                !activeCategory
                  ? 'bg-indigo-500/20 text-indigo-300 font-medium'
                  : 'text-gray-400 hover:bg-gray-700 hover:text-gray-200'
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
                  activeCategory === cat.slug
                    ? 'bg-indigo-500/20 text-indigo-300 font-medium'
                    : 'text-gray-400 hover:bg-gray-700 hover:text-gray-200'
                }`}
              >
                <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: cat.color }} />
                <span className="flex-1">{cat.name_ja}</span>
                <span className="text-gray-600 text-xs">{cat.name_en}</span>
                {cat.article_count > 0 && (
                  <span className="text-xs text-gray-500 tabular-nums">{cat.article_count}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      </div>

      {tags.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">タグ</h3>
          <div className="flex flex-wrap gap-1.5">
            {tags.slice(0, 30).map((tag) => (
              <button
                key={tag.slug}
                onClick={() => onSelectTag(tag.name)}
                className="text-xs bg-gray-700 hover:bg-indigo-500/30 hover:text-indigo-300 text-gray-400 px-2 py-0.5 rounded transition-colors"
              >
                #{tag.name}
                <span className="ml-1 text-gray-600">{tag.article_count}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="pt-4 border-t border-gray-700">
        <Link
          to="/import"
          className="flex items-center gap-2 text-sm text-gray-500 hover:text-indigo-400 transition-colors"
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
