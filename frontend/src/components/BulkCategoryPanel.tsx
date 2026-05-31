import { useState } from 'react';
import type { Category } from '../types';

type CatState = 'neutral' | 'add' | 'remove';

interface Props {
  categories: Category[];
  selectedCount: number;
  totalCount: number;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onUpdate: (add: string[], remove: string[]) => Promise<void>;
  onCancel: () => void;
}

export default function BulkCategoryPanel({
  categories, selectedCount, totalCount,
  onSelectAll, onClearSelection, onUpdate, onCancel,
}: Props) {
  const [catState, setCatState] = useState<Record<string, CatState>>({});
  const [updating, setUpdating] = useState(false);

  const cycle = (slug: string) => {
    setCatState((prev) => {
      const cur = prev[slug] ?? 'neutral';
      const next: CatState = cur === 'neutral' ? 'add' : cur === 'add' ? 'remove' : 'neutral';
      return { ...prev, [slug]: next };
    });
  };

  const addList = categories.filter((c) => (catState[c.slug] ?? 'neutral') === 'add').map((c) => c.slug);
  const removeList = categories.filter((c) => (catState[c.slug] ?? 'neutral') === 'remove').map((c) => c.slug);
  const hasChanges = addList.length > 0 || removeList.length > 0;
  const canUpdate = selectedCount > 0 && hasChanges;

  const handleUpdate = async () => {
    if (!canUpdate) return;
    setUpdating(true);
    try {
      await onUpdate(addList, removeList);
    } finally {
      setUpdating(false);
    }
  };

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 bg-[#0e0e14] border-t border-rim shadow-2xl">
      <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-3 flex-wrap sm:flex-nowrap">

        {/* Selection count + controls */}
        <div className="flex items-center gap-2 flex-shrink-0 min-w-0">
          <span className="text-sm font-semibold text-slate-100 whitespace-nowrap">
            {selectedCount}件選択中
          </span>
          <button
            onClick={onSelectAll}
            className="text-xs text-amber-400 hover:text-amber-300 transition-colors whitespace-nowrap"
          >
            全選択
          </button>
          <button
            onClick={onClearSelection}
            className="text-xs text-slate-500 hover:text-slate-300 transition-colors whitespace-nowrap"
          >
            解除
          </button>
        </div>

        <div className="hidden sm:block w-px h-5 bg-rim flex-shrink-0" />

        {/* Category chips */}
        <div className="flex-1 min-w-0 overflow-x-auto">
          <div className="flex items-center gap-1.5 pb-0.5">
            {categories.map((cat) => {
              const state = catState[cat.slug] ?? 'neutral';
              return (
                <button
                  key={cat.slug}
                  onClick={() => cycle(cat.slug)}
                  className={`flex-shrink-0 text-xs px-2.5 py-1 rounded-full font-medium transition-colors whitespace-nowrap ${
                    state === 'add'
                      ? 'bg-amber-500 text-black'
                      : state === 'remove'
                      ? 'bg-red-600 text-white'
                      : 'bg-surface2 text-slate-400 border border-rim hover:bg-rim'
                  }`}
                >
                  {state === 'add' && '+ '}
                  {state === 'remove' && '× '}
                  {cat.name_ja}
                </button>
              );
            })}
          </div>
        </div>

        <div className="hidden sm:block w-px h-5 bg-rim flex-shrink-0" />

        {/* Action buttons */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={handleUpdate}
            disabled={!canUpdate || updating}
            className="text-sm px-4 py-1.5 rounded-full bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-black font-bold transition-colors"
          >
            {updating ? '更新中...' : '更新'}
          </button>
          <button
            onClick={onCancel}
            className="text-sm px-3 py-1.5 rounded-full bg-surface2 hover:bg-rim border border-rim text-slate-300 font-medium transition-colors"
          >
            ✕
          </button>
        </div>

      </div>

      {/* Hint */}
      {categories.length > 0 && (
        <div className="max-w-7xl mx-auto px-4 pb-2">
          <p className="text-xs text-slate-600">カテゴリーをクリック: グレー = 変更なし → <span className="text-amber-500">橙 = 追加</span> → <span className="text-red-500">赤 = 削除</span></p>
        </div>
      )}
    </div>
  );
}
