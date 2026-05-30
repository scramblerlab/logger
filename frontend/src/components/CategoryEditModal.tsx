import { useState } from 'react';
import { api } from '../api/client';
import type { Category, CategoryCreate } from '../types';

const COLOR_SWATCHES = [
  '#E84040', '#4A90D9', '#7B68EE', '#F5A623', '#7ED321',
  '#9B59B6', '#FF6B35', '#2ECC71', '#95A5A6', '#F39C12',
  '#E74C3C', '#3498DB', '#1ABC9C', '#E67E22', '#34495E',
];

interface Props {
  categories: Category[];
  onClose: () => void;
  onCategoryAdded: (cat: Category) => void;
  onCategoryDeleted: (slug: string) => void;
}

export default function CategoryEditModal({ categories, onClose, onCategoryAdded, onCategoryDeleted }: Props) {
  const [nameEn, setNameEn] = useState('');
  const [nameJa, setNameJa] = useState('');
  const [color, setColor] = useState(COLOR_SWATCHES[0]);
  const [adding, setAdding] = useState(false);
  const [deletingSlug, setDeletingSlug] = useState<string | null>(null);
  const [confirmSlug, setConfirmSlug] = useState<string | null>(null);
  const [error, setError] = useState('');

  const slugFromName = (name: string) =>
    name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  const handleAdd = async () => {
    const slug = slugFromName(nameEn);
    if (!slug || !nameEn || !nameJa) { setError('全項目を入力してください'); return; }
    setError('');
    setAdding(true);
    try {
      const body: CategoryCreate = { slug, name_en: nameEn, name_ja: nameJa, color };
      const cat = await api.categories.create(body);
      onCategoryAdded(cat);
      setNameEn(''); setNameJa(''); setColor(COLOR_SWATCHES[0]);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'エラーが発生しました');
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (slug: string) => {
    setDeletingSlug(slug);
    try {
      await api.categories.delete(slug);
      onCategoryDeleted(slug);
    } catch {
      setError('削除に失敗しました');
    } finally {
      setDeletingSlug(null);
      setConfirmSlug(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={onClose}>
      <div
        className="bg-surface rounded-2xl shadow-2xl w-full max-w-md mx-4 max-h-[90vh] flex flex-col ring-1 ring-rim"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-rim">
          <h2 className="text-base font-semibold text-slate-100">カテゴリーを編集</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-100 text-xl leading-none transition-colors">×</button>
        </div>

        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">
          {/* Existing categories */}
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">現在のカテゴリー</p>
            <ul className="space-y-0.5">
              {categories.map((cat) => (
                <li key={cat.slug} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-surface2 group transition-colors">
                  <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: cat.color }} />
                  <span className="text-sm text-slate-200 flex-1">{cat.name_ja}</span>
                  <span className="text-xs text-slate-500">{cat.name_en}</span>
                  {cat.article_count > 0 && <span className="text-xs text-slate-600 tabular-nums">{cat.article_count}</span>}
                  {confirmSlug === cat.slug ? (
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-red-400">削除?</span>
                      <button
                        onClick={() => handleDelete(cat.slug)}
                        disabled={deletingSlug === cat.slug}
                        className="text-xs text-white bg-red-600 hover:bg-red-500 px-2 py-0.5 rounded-lg transition-colors disabled:opacity-50"
                      >
                        {deletingSlug === cat.slug ? '...' : 'はい'}
                      </button>
                      <button onClick={() => setConfirmSlug(null)} className="text-xs text-slate-400 hover:text-slate-100 px-1 transition-colors">
                        いいえ
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmSlug(cat.slug)}
                      className="opacity-0 group-hover:opacity-100 text-slate-600 hover:text-red-400 transition-all text-sm"
                    >
                      🗑
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>

          {/* Add new */}
          <div className="border-t border-rim pt-4">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">新しいカテゴリーを追加</p>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">英語名 (slug用)</label>
                  <input type="text" value={nameEn} onChange={(e) => setNameEn(e.target.value)}
                    placeholder="e.g. hiking"
                    className="w-full bg-surface2 border border-rim2 text-slate-100 placeholder-slate-500 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">日本語名</label>
                  <input type="text" value={nameJa} onChange={(e) => setNameJa(e.target.value)}
                    placeholder="例: ハイキング"
                    className="w-full bg-surface2 border border-rim2 text-slate-100 placeholder-slate-500 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>
              </div>
              {nameEn && (
                <p className="text-xs text-slate-500">slug: <code className="text-amber-400">{slugFromName(nameEn)}</code></p>
              )}
              <div>
                <label className="text-xs text-slate-400 mb-1.5 block">カラー</label>
                <div className="flex flex-wrap gap-2">
                  {COLOR_SWATCHES.map((c) => (
                    <button key={c} type="button" onClick={() => setColor(c)}
                      className={`w-6 h-6 rounded-full transition-transform ${color === c ? 'ring-2 ring-offset-2 ring-offset-surface ring-white scale-110' : 'hover:scale-110'}`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>
              {error && <p className="text-xs text-red-400">{error}</p>}
              <button onClick={handleAdd} disabled={adding || !nameEn || !nameJa}
                className="w-full bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-black text-sm font-semibold py-2 rounded-full transition-colors"
              >
                {adding ? '追加中...' : '追加する'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
