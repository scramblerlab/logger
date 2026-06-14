import { useEffect, useState } from 'react';
import type { Block, BlockType } from '../utils/blocks';

interface Props {
  block: Block | null;
  blockIndex: number;
  blockCount: number;
  onUpdate: (patch: Partial<Block>) => void;
  onChangeType: (type: BlockType) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
  onInsertImage: () => void;
  onRotate: () => void;
  reorderMode: boolean;
  onToggleReorder: () => void;
}

function ToolBtn({
  label, active, onClick, title,
}: {
  label: string; active?: boolean; onClick: () => void; title?: string;
}) {
  return (
    <button
      type="button"
      onClick={e => { e.preventDefault(); onClick(); }}
      title={title}
      className={`px-2.5 py-2 text-xs font-semibold rounded transition-colors select-none
        ${active
          ? 'bg-amber-500 text-black'
          : 'text-slate-300 hover:bg-rim2 active:bg-rim2'
        }`}
    >
      {label}
    </button>
  );
}

function Divider() {
  return <div className="w-px h-5 bg-rim2 shrink-0" />;
}

export default function BlockToolbar({
  block, blockIndex, blockCount, onUpdate, onChangeType,
  onMoveUp, onMoveDown, onDelete, onInsertImage, onRotate,
  reorderMode, onToggleReorder,
}: Props) {
  const [keyboardBottom, setKeyboardBottom] = useState(0);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      setKeyboardBottom(Math.max(0, window.innerHeight - vv.height - vv.offsetTop));
    };
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);

  if (!block) return null;

  const applyInline = (wrap: (s: string) => string) => {
    if (block.type !== 'paragraph' && block.type !== 'heading') return;
    const el = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null;
    if (!el || !('selectionStart' in el)) return;
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? 0;
    const val = el.value;
    if (start === end) return;
    const selected = val.slice(start, end);
    const wrapped = wrap(selected);
    const next = val.slice(0, start) + wrapped + val.slice(end);
    if (block.type === 'paragraph') onUpdate({ content: next } as Partial<Block>);
    else onUpdate({ content: next } as Partial<Block>);
    setTimeout(() => {
      el.selectionStart = start;
      el.selectionEnd = start + wrapped.length;
    }, 0);
  };

  const isHeading = block.type === 'heading';
  const isList = block.type === 'list';
  const isImage = block.type === 'image';

  return (
    <div
      className="fixed left-0 right-0 z-50 bg-surface border-t border-rim2 flex items-center gap-0.5 px-2 overflow-x-auto"
      style={{ bottom: keyboardBottom + 12, height: 36 }}
    >
      {/* Inline formatting */}
      <ToolBtn label="B" onClick={() => applyInline(s => `**${s}**`)} title="太字" />
      <ToolBtn label="I" onClick={() => applyInline(s => `_${s}_`)} title="斜体" />
      <ToolBtn label="🔗" onClick={() => applyInline(s => `[${s}]()`)} title="リンク" />

      {!isImage && <Divider />}

      {/* Heading level — hidden for image blocks */}
      {!isImage && ['H2', 'H3'].map((h, i) => {
        const lvl = (i + 2) as 2 | 3 | 4;
        return (
          <ToolBtn
            key={h}
            label={h}
            active={isHeading && (block as { level: number }).level === lvl}
            onClick={() => {
              if (block.type === 'heading') onUpdate({ level: lvl } as Partial<Block>);
              else onChangeType('heading');
            }}
          />
        );
      })}

      <Divider />

      {/* Block type conversions */}
      <ToolBtn
        label="1."
        active={isList && (block as { ordered: boolean }).ordered}
        onClick={() => {
          if (block.type === 'list') onUpdate({ ordered: true } as Partial<Block>);
          else onChangeType('list');
        }}
        title="番号付きリスト"
      />
      <ToolBtn
        label="•"
        active={isList && !(block as { ordered: boolean }).ordered}
        onClick={() => {
          if (block.type === 'list') onUpdate({ ordered: false } as Partial<Block>);
          else onChangeType('list');
        }}
        title="箇条書きリスト"
      />
      <ToolBtn label="🖼" onClick={onInsertImage} title="画像を挿入" />
      {block.type === 'image' && (
        <ToolBtn label="↻" onClick={onRotate} title="時計回りに回転" />
      )}

      <Divider />

      {/* Move + reorder mode + delete */}
      <ToolBtn label="↑" onClick={onMoveUp} title="上に移動" />
      <ToolBtn label="↓" onClick={onMoveDown} title="下に移動" />
      <ToolBtn label="⇅" active={reorderMode} onClick={onToggleReorder} title="並び替えモード" />
      <span className="text-slate-600 text-xs px-2 select-none" title={`${blockIndex + 1} / ${blockCount}`}>
        {blockIndex + 1}/{blockCount}
      </span>
      <ToolBtn label="✕" onClick={onDelete} title="削除" />
    </div>
  );
}
