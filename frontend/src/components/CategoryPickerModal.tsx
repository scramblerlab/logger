import type { Category } from '../types';
import { useAuth } from '../context/AuthContext';

interface Props {
  categories: Category[];
  activeCategory: string | null;
  allCount: number;
  onSelectCategory: (slug: string | null) => void;
  onOpenCategoryEdit: () => void;
  onClose: () => void;
  categoryLabels?: Map<string, string>;
  labels?: { category: string; all: string; tag: string };
}

/**
 * Category picker for every breakpoint — replaces both the desktop sidebar
 * list and the mobile tab row.
 */
export default function CategoryPickerModal({
  categories, activeCategory, allCount,
  onSelectCategory, onOpenCategoryEdit, onClose,
  categoryLabels, labels,
}: Props) {
  const { isEditor } = useAuth();

  const pick = (slug: string | null) => {
    onSelectCategory(slug);
    onClose();
  };

  const itemCls = (active: boolean) =>
    `w-full text-left px-3 py-2.5 rounded-lg text-sm flex items-center gap-2 transition-colors ${
      active
        ? 'bg-amber-500/20 text-amber-400 font-medium'
        : 'text-slate-400 hover:bg-surface2 hover:text-slate-100'
    }`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={onClose}>
      <div
        className="bg-surface rounded-2xl shadow-2xl w-full max-w-md mx-4 max-h-[90vh] flex flex-col ring-1 ring-rim"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-rim">
          <h2 className="text-base font-semibold text-slate-100">{labels?.category ?? 'カテゴリー'}</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-100 text-xl leading-none transition-colors">×</button>
        </div>

        <div className="overflow-y-auto flex-1 px-3 py-3">
          <ul className="space-y-0.5">
            <li>
              <button onClick={() => pick(null)} className={itemCls(!activeCategory)}>
                <span className="flex-1">{labels?.all ?? 'すべて / All'}</span>
                {!!allCount && <span className="text-xs text-slate-500 tabular-nums">{allCount}</span>}
              </button>
            </li>
            {categories.map((cat) => (
              <li key={cat.slug}>
                <button onClick={() => pick(cat.slug)} className={itemCls(activeCategory === cat.slug)}>
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

        {isEditor && (
          <div className="px-5 py-3 border-t border-rim">
            <button
              onClick={() => { onClose(); onOpenCategoryEdit(); }}
              className="btn btn-outline w-full"
            >
              カテゴリーを編集
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
