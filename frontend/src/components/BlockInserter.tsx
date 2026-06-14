import { useEffect } from 'react';
import type { BlockType } from '../utils/blocks';

interface Props {
  open: boolean;
  onSelect: (type: BlockType) => void;
  onClose: () => void;
}

const BLOCK_TYPES: { type: BlockType; label: string; icon: string }[] = [
  { type: 'paragraph', icon: '¶', label: '段落' },
  { type: 'heading', icon: 'H', label: '見出し' },
  { type: 'list', icon: '≡', label: 'リスト' },
  { type: 'quote', icon: '"', label: '引用' },
  { type: 'code', icon: '</>', label: 'コード' },
  { type: 'image', icon: '🖼', label: '画像' },
  { type: 'video', icon: '▶', label: '動画' },
];

export default function BlockInserter({ open, onSelect, onClose }: Props) {
  // Lock scroll when open
  useEffect(() => {
    if (open) document.body.style.overflow = 'hidden';
    else document.body.style.overflow = '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      {/* Sheet */}
      <div className="relative bg-surface rounded-t-2xl pb-safe">
        {/* Drag handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-rim2" />
        </div>
        <p className="text-sm font-semibold text-slate-400 px-4 pb-3">ブロックを追加</p>

        <div className="grid grid-cols-3 gap-3 px-4 pb-4">
          {BLOCK_TYPES.map(({ type, icon, label }) => (
            <button
              key={type}
              type="button"
              onClick={() => { onSelect(type); onClose(); }}
              className="flex flex-col items-center gap-1.5 py-4 rounded-xl bg-surface2 border border-rim2 active:border-amber-500 transition-colors"
            >
              <span className="text-xl text-slate-300 leading-none font-mono select-none">{icon}</span>
              <span className="text-xs text-slate-400">{label}</span>
            </button>
          ))}
        </div>

        <div className="px-4 pb-4">
          <button
            type="button"
            onClick={onClose}
            className="btn btn-outline w-full justify-center"
          >
            キャンセル
          </button>
        </div>
      </div>
    </div>
  );
}
