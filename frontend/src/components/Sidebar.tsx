import type { Tag } from '../types';

interface Props {
  tags: Tag[];
  onSelectTag: (tag: string) => void;
  labels?: { category: string; all: string; tag: string };
}

/**
 * Tags only. Category selection lives in CategoryPickerModal and every editor
 * action lives in BulkActionsModal, so nothing else belongs here.
 */
export default function Sidebar({ tags, onSelectTag, labels }: Props) {
  if (tags.length === 0) return null;

  return (
    <aside className="w-64 flex-shrink-0">
      <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
        {labels?.tag ?? 'タグ'}
      </h3>
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
    </aside>
  );
}
