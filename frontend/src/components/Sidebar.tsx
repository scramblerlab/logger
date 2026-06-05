import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { Category, Tag } from '../types';
import { useAuth } from '../context/AuthContext';
import { useAiJob } from '../context/AiJobContext';
import LoginModal from './LoginModal';

interface Props {
  categories: Category[];
  tags: Tag[];
  activeCategory: string | null;
  onSelectCategory: (slug: string | null) => void;
  onSelectTag: (tag: string) => void;
  onOpenCategoryEdit: () => void;
  onBulkCategorize: () => void;
  onShopifyExport: () => void;
  categoryLabels?: Map<string, string>;
  labels?: { category: string; all: string; tag: string };
}

export default function Sidebar({
  categories, tags, activeCategory,
  onSelectCategory, onSelectTag,
  onOpenCategoryEdit, onBulkCategorize, onShopifyExport,
  categoryLabels, labels,
}: Props) {
  const { isEditor, logout } = useAuth();
  const { status: aiStatus, progress: aiProgress, startJob, commentStatus, commentProgress, startCommentJob } = useAiJob();
  const [showLogin, setShowLogin] = useState(false);
  return (
    <>
    <aside className="w-64 flex-shrink-0 space-y-6">
      <div>
        {/* Category header */}
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{labels?.category ?? 'カテゴリー'}</h3>
          {isEditor && (
            <div className="flex items-center gap-1.5">
              <button
                onClick={startJob}
                disabled={aiStatus === 'running'}
                title="AI カテゴライズ"
                className="text-xs px-2.5 py-1 rounded-full bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black font-semibold transition-colors whitespace-nowrap"
              >
                {aiStatus === 'running' ? '⏳ AI中...' : 'AI分類'}
              </button>
              <button
                onClick={onOpenCategoryEdit}
                title="カテゴリーを編集"
                className="text-xs px-2.5 py-1 rounded-lg bg-surface2 hover:bg-rim border border-rim text-slate-300 font-medium transition-colors"
              >
                編集
              </button>
              <button
                onClick={onBulkCategorize}
                title="カテゴリー一括更新"
                className="text-xs px-2.5 py-1 rounded-lg bg-surface2 hover:bg-rim border border-rim text-slate-300 font-medium transition-colors"
              >
                一括更新
              </button>
            </div>
          )}
        </div>

        {/* AI progress */}
        {aiStatus !== 'idle' && aiProgress && (
          <p className="text-xs text-amber-400 mb-2">{aiProgress}</p>
        )}
        {isEditor && (
          <div className="flex items-center gap-1.5 mb-2">
            <button
              onClick={startCommentJob}
              disabled={commentStatus === 'running'}
              title="AIコメント一括追加"
              className="text-xs px-2.5 py-1 rounded-full bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black font-semibold transition-colors whitespace-nowrap"
            >
              {commentStatus === 'running' ? '⏳ AIコメント中...' : 'AIコメント追加'}
            </button>
          </div>
        )}
        {commentStatus !== 'idle' && commentProgress && (
          <p className="text-xs text-amber-400 mb-2">{commentProgress}</p>
        )}

        <ul className="space-y-0.5">
          <li>
            <button
              onClick={() => onSelectCategory(null)}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                !activeCategory
                  ? 'bg-amber-500/20 text-amber-400 font-medium'
                  : 'text-slate-400 hover:bg-surface2 hover:text-slate-100'
              }`}
            >
              {labels?.all ?? 'すべて / All'}
            </button>
          </li>
          {categories.map((cat) => (
            <li key={cat.slug}>
              <button
                onClick={() => onSelectCategory(cat.slug)}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm flex items-center gap-2 transition-colors ${
                  activeCategory === cat.slug
                    ? 'bg-amber-500/20 text-amber-400 font-medium'
                    : 'text-slate-400 hover:bg-surface2 hover:text-slate-100'
                }`}
              >
                <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: cat.color }} />
                <span className="flex-1">{categoryLabels?.get(cat.slug) ?? cat.name_ja}</span>
                <span className="text-slate-600 text-xs">{cat.name_en}</span>
                {cat.article_count > 0 && (
                  <span className="text-xs text-slate-500 tabular-nums">{cat.article_count}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      </div>

      {tags.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">{labels?.tag ?? 'タグ'}</h3>
          <div className="flex flex-wrap gap-1.5">
            {tags.slice(0, 30).map((tag) => (
              <button
                key={tag.slug}
                onClick={() => onSelectTag(tag.name)}
                className="text-xs bg-surface2 hover:bg-amber-500/30 hover:text-amber-400 text-slate-400 px-2 py-0.5 rounded transition-colors"
              >
                #{tag.name}
                <span className="ml-1 text-slate-600">{tag.article_count}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {isEditor && (
        <div className="pt-4 border-t border-rim space-y-2">
          <Link
            to="/import"
            className="flex items-center gap-2 text-sm text-slate-500 hover:text-amber-400 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            WordPress一括インポート
          </Link>
          <Link
            to="/import/shopify"
            className="flex items-center gap-2 text-sm text-slate-500 hover:text-amber-400 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            Shopifyブログ一括インポート
          </Link>
          <button
            onClick={onShopifyExport}
            className="flex items-center gap-2 text-sm text-slate-500 hover:text-amber-400 transition-colors w-full text-left"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8v-1a3 3 0 013-3h10a3 3 0 013 3v1m-4 8l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Shopifyブログにエクスポート
          </button>
        </div>
      )}
      <div className="pt-4 border-t border-rim">
        {isEditor ? (
          <button
            onClick={() => logout()}
            className="text-xs px-2.5 py-1 rounded-full bg-surface2 hover:bg-rim border border-rim text-slate-300 font-semibold transition-colors"
          >
            ログアウト
          </button>
        ) : (
          <button
            onClick={() => setShowLogin(true)}
            className="text-xs px-2.5 py-1 rounded-full bg-surface2 hover:bg-rim border border-rim text-slate-300 font-semibold transition-colors"
          >
            ログイン
          </button>
        )}
      </div>
    </aside>
    {showLogin && <LoginModal onClose={() => setShowLogin(false)} />}
    </>
  );
}
