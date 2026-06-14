import { useCallback, useRef, useState } from 'react';
import type { Block, BlockType } from '../utils/blocks';
import { createBlock, moveBlock } from '../utils/blocks';
import ParagraphBlock from './blocks/ParagraphBlock';
import HeadingBlock from './blocks/HeadingBlock';
import ListBlock from './blocks/ListBlock';
import QuoteBlock from './blocks/QuoteBlock';
import CodeBlock from './blocks/CodeBlock';
import ImageBlock from './blocks/ImageBlock';
import VideoBlock from './blocks/VideoBlock';
import BlockToolbar from './BlockToolbar';
import BlockInserter from './BlockInserter';

interface Props {
  blocks: Block[];
  onChange: (blocks: Block[]) => void;
  editSlug?: string;
  onUploadImage?: (blockId: string, file: File) => Promise<string | null>;
}

// Per-block stable callback shapes — one entry per block ID, created once, reused every render.
type PerBlockCbs = {
  contentChange: (content: string) => void;
  listChange: (items: string[]) => void;
  listOrderedToggle: (ordered: boolean) => void;
  quoteChange: (content: string, attribution?: string) => void;
  codeChange: (code: string, language?: string) => void;
  imageChange: (patch: { src?: string; caption?: string; pendingFile?: File }) => void;
  videoChange: (patch: { src?: string; url?: string; caption?: string; pendingFile?: File }) => void;
  onFocus: () => void;
};

export default function BlockEditor({ blocks, onChange, editSlug, onUploadImage }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [inserterAt, setInserterAt] = useState<number | null>(null);
  const [showInserter, setShowInserter] = useState(false);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const [reorderMode, setReorderMode] = useState(false);
  const imageFileRef = useRef<HTMLInputElement>(null);
  const pendingImageInsertRef = useRef<string | null>(null);
  const blockEls = useRef<(HTMLDivElement | null)[]>([]);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Always-current ref so async callbacks never read stale blocks
  const blocksRef = useRef(blocks);
  blocksRef.current = blocks;

  const selectedIndex = selectedId ? blocks.findIndex(b => b.id === selectedId) : -1;
  const selectedBlock = selectedIndex >= 0 ? blocks[selectedIndex] : null;

  // ── Block update helpers ─────────────────────────────────────────────────

  // Stable: onChange === setBlocks (React state setter, never changes reference)
  const updateBlock = useCallback((id: string, patch: Partial<Block>) => {
    onChange(blocksRef.current.map(b => b.id === id ? { ...b, ...patch } as Block : b));
  }, [onChange]);

  const insertBlock = useCallback((type: BlockType, beforeIndex: number) => {
    const nb = createBlock(type);
    const arr = [...blocksRef.current];
    arr.splice(beforeIndex, 0, nb);
    onChange(arr);
    setSelectedId(nb.id);
  }, [onChange]);

  const deleteBlock = useCallback((id: string) => {
    const remaining = blocksRef.current.filter(b => b.id !== id);
    onChange(remaining.length > 0 ? remaining : [createBlock('paragraph')]);
    setSelectedId(null);
  }, [onChange]);

  const changeType = useCallback((id: string, type: BlockType) => {
    const old = blocksRef.current.find(b => b.id === id);
    if (!old) return;
    const nb = createBlock(type);
    if ('content' in old && 'content' in nb) (nb as { content: string }).content = (old as { content: string }).content;
    onChange(blocksRef.current.map(b => b.id === id ? { ...nb, id } : b));
  }, [onChange]);

  // ── Image upload flow ────────────────────────────────────────────────────

  const handleUploadForBlock = useCallback(async (blockId: string, file: File) => {
    if (editSlug && onUploadImage) {
      const relPath = await onUploadImage(blockId, file);
      if (relPath) {
        updateBlock(blockId, { src: relPath, pendingFile: undefined } as Partial<Block>);
      }
    }
  }, [editSlug, onUploadImage, updateBlock]);

  const handleToolbarInsertImage = useCallback(() => {
    if (imageFileRef.current) {
      pendingImageInsertRef.current = selectedId;
      imageFileRef.current.value = '';
      imageFileRef.current.click();
    }
  }, [selectedId]);

  const handleToolbarImageFile = useCallback((file: File) => {
    const afterId = pendingImageInsertRef.current;
    pendingImageInsertRef.current = null;
    const afterIndex = afterId ? blocksRef.current.findIndex(b => b.id === afterId) : blocksRef.current.length - 1;
    const nb: Block = { id: crypto.randomUUID(), type: 'image', src: '', caption: undefined, pendingFile: file };
    const arr = [...blocksRef.current];
    arr.splice(afterIndex + 1, 0, nb);
    onChange(arr);
    setSelectedId(nb.id);
    if (editSlug && onUploadImage) {
      onUploadImage(nb.id, file).then(relPath => {
        if (relPath) updateBlock(nb.id, { src: relPath, pendingFile: undefined } as Partial<Block>);
      });
    }
  }, [onChange, editSlug, onUploadImage, updateBlock]);

  // ── Per-block stable callback cache ─────────────────────────────────────
  // Handlers are created once per block ID and reused on every render,
  // so React.memo on block components can skip re-renders for unchanged blocks.

  const cbCache = useRef(new Map<string, PerBlockCbs>());

  // Evict entries for blocks that have been deleted
  const liveIds = new Set(blocks.map(b => b.id));
  for (const id of cbCache.current.keys()) {
    if (!liveIds.has(id)) cbCache.current.delete(id);
  }

  // Safety: if updateBlock reference ever changed (shouldn't happen since onChange
  // is setBlocks, a stable React state setter), clear the cache so handlers rebuild.
  const prevUpdateBlock = useRef(updateBlock);
  if (prevUpdateBlock.current !== updateBlock) {
    cbCache.current.clear();
    prevUpdateBlock.current = updateBlock;
  }

  const getCbs = (blockId: string): PerBlockCbs => {
    if (!cbCache.current.has(blockId)) {
      cbCache.current.set(blockId, {
        contentChange:      (content) =>               updateBlock(blockId, { content } as Partial<Block>),
        listChange:         (items) =>                 updateBlock(blockId, { items } as Partial<Block>),
        listOrderedToggle:  (ordered) =>               updateBlock(blockId, { ordered } as Partial<Block>),
        quoteChange:        (content, attribution) =>  updateBlock(blockId, { content, attribution } as Partial<Block>),
        codeChange:         (code, language) =>        updateBlock(blockId, { code, language } as Partial<Block>),
        imageChange:        (patch) => {
          updateBlock(blockId, patch as Partial<Block>);
          if (patch.pendingFile) handleUploadForBlock(blockId, patch.pendingFile);
        },
        videoChange:        (patch) =>                 updateBlock(blockId, patch as Partial<Block>),
        onFocus:            () =>                      setSelectedId(blockId),
      });
    }
    return cbCache.current.get(blockId)!;
  };

  // ── Drag reorder (pointer events) ───────────────────────────────────────

  const handleDragStart = (index: number) => setDragFrom(index);

  const handleDragMove = (e: React.PointerEvent) => {
    if (dragFrom === null) return;
    const y = e.clientY;
    let target = blocks.length - 1;
    for (let i = 0; i < blockEls.current.length; i++) {
      const el = blockEls.current[i];
      if (!el) continue;
      const { top, height } = el.getBoundingClientRect();
      if (y <= top + height / 2) { target = i; break; }
    }
    setDropAt(target);
  };

  const handleDragEnd = () => {
    if (dragFrom !== null && dropAt !== null && dragFrom !== dropAt) {
      onChange(moveBlock(blocks, dragFrom, dropAt));
    }
    setDragFrom(null);
    setDropAt(null);
  };

  const startLongPress = (e: React.PointerEvent, index: number) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    longPressTimer.current = setTimeout(() => {
      longPressTimer.current = null;
      handleDragStart(index);
    }, 400);
  };

  const cancelLongPress = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  // ── Render block content ─────────────────────────────────────────────────

  const renderBlock = (block: Block) => {
    const cbs = getCbs(block.id);
    switch (block.type) {
      case 'paragraph':
        return (
          <ParagraphBlock
            content={block.content}
            onChange={cbs.contentChange}
            onFocus={cbs.onFocus}
          />
        );
      case 'heading':
        return (
          <HeadingBlock
            content={block.content}
            level={block.level}
            onChange={cbs.contentChange}
            onFocus={cbs.onFocus}
          />
        );
      case 'list':
        return (
          <ListBlock
            items={block.items}
            ordered={block.ordered}
            onChange={cbs.listChange}
            onToggleOrdered={cbs.listOrderedToggle}
            onFocus={cbs.onFocus}
          />
        );
      case 'quote':
        return (
          <QuoteBlock
            content={block.content}
            attribution={block.attribution}
            onChange={cbs.quoteChange}
            onFocus={cbs.onFocus}
          />
        );
      case 'code':
        return (
          <CodeBlock
            code={block.code}
            language={block.language}
            onChange={cbs.codeChange}
            onFocus={cbs.onFocus}
          />
        );
      case 'image':
        return (
          <ImageBlock
            src={block.src}
            caption={block.caption}
            rotation={block.rotation}
            pendingFile={block.pendingFile}
            editSlug={editSlug}
            onChange={cbs.imageChange}
            onFocus={cbs.onFocus}
          />
        );
      case 'video':
        return (
          <VideoBlock
            src={block.src}
            url={block.url}
            caption={block.caption}
            pendingFile={block.pendingFile}
            editSlug={editSlug}
            onChange={cbs.videoChange}
            onFocus={cbs.onFocus}
          />
        );
    }
  };

  const BLOCK_LABEL: Record<BlockType, string> = {
    paragraph: '¶', heading: 'H', list: '≡', quote: '"', code: '</>', image: '🖼', video: '▶',
  };

  return (
    <div className="relative">
      {/* Hidden file input for toolbar "insert image" */}
      <input
        ref={imageFileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) handleToolbarImageFile(f); }}
      />

      {/* Block list */}
      <div className="space-y-0.5">
        {blocks.map((block, index) => {
          const isSelected = block.id === selectedId;
          const isDragging = dragFrom === index;
          const isDropTarget = dropAt === index && dragFrom !== null;

          return (
            <div key={block.id}>
              {/* Drop target indicator */}
              {isDropTarget && dragFrom !== null && index < dragFrom && (
                <div className="h-0.5 bg-amber-500 rounded-full my-1 mx-2" />
              )}

              <div
                ref={el => { blockEls.current[index] = el; }}
                className={`relative rounded-xl border transition-colors ${
                  isSelected ? 'border-amber-500/60 bg-surface/40' : 'border-transparent'
                } ${isDragging ? 'opacity-40' : ''}`}
                onClick={reorderMode ? () => setSelectedId(block.id) : undefined}
              >
                {/* Block type label */}
                {isSelected && !reorderMode && (
                  <div className="absolute -top-2 left-3 bg-surface2 border border-rim2 px-1.5 py-0.5 rounded text-[10px] text-slate-500 font-mono z-10 select-none">
                    {BLOCK_LABEL[block.type]}
                  </div>
                )}

                {reorderMode && isSelected && (
                  <div
                    className="absolute left-0 top-0 bottom-0 w-11 flex items-center justify-center rounded-l-xl bg-amber-500/10 border-r border-amber-500/40 cursor-grab active:cursor-grabbing text-amber-400 select-none touch-none z-10"
                    onPointerDown={e => startLongPress(e, index)}
                    onPointerMove={handleDragMove}
                    onPointerUp={() => { cancelLongPress(); handleDragEnd(); }}
                    onPointerCancel={() => { cancelLongPress(); handleDragEnd(); }}
                    title="長押しでドラッグ"
                  >
                    ⠿
                  </div>
                )}

                <div className={`py-2 ${reorderMode ? `${isSelected ? 'pl-14' : 'px-3'} pr-3 pointer-events-none` : 'px-3'}`}>
                  {renderBlock(block)}
                </div>
              </div>

              {/* Drop target indicator (below) */}
              {isDropTarget && dragFrom !== null && index >= dragFrom && (
                <div className="h-0.5 bg-amber-500 rounded-full my-1 mx-2" />
              )}

              {/* Between-block inserter */}
              <div className="flex justify-center my-0.5 opacity-0 hover:opacity-100 transition-opacity">
                <button
                  type="button"
                  onClick={() => { setInserterAt(index + 1); setShowInserter(true); }}
                  className="w-6 h-6 rounded-full border border-rim2 text-slate-600 text-xs flex items-center justify-center hover:border-amber-500 hover:text-amber-500 active:border-amber-500 transition-colors"
                  title="ここにブロックを追加"
                >
                  +
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* End-of-content inserter */}
      <button
        type="button"
        onClick={() => { setInserterAt(blocks.length); setShowInserter(true); }}
        className="mt-3 w-full py-2.5 rounded-xl border border-dashed border-rim2 text-sm text-slate-600 hover:border-amber-500 hover:text-amber-500 active:border-amber-500 transition-colors"
      >
        + ブロックを追加
      </button>

      {/* Floating toolbar */}
      <BlockToolbar
        block={selectedBlock}
        blockIndex={selectedIndex}
        blockCount={blocks.length}
        onUpdate={patch => { if (selectedId) updateBlock(selectedId, patch); }}
        onChangeType={type => { if (selectedId) changeType(selectedId, type); }}
        onMoveUp={() => {
          if (selectedIndex > 0) {
            onChange(moveBlock(blocks, selectedIndex, selectedIndex - 1));
          }
        }}
        onMoveDown={() => {
          if (selectedIndex < blocks.length - 1) {
            onChange(moveBlock(blocks, selectedIndex, selectedIndex + 1));
          }
        }}
        onDelete={() => { if (selectedId) deleteBlock(selectedId); }}
        onInsertImage={handleToolbarInsertImage}
        onRotate={() => {
          if (selectedId && selectedBlock?.type === 'image') {
            const next = (((selectedBlock.rotation ?? 0) + 90) % 360) as 0 | 90 | 180 | 270;
            updateBlock(selectedId, { rotation: next } as Partial<Block>);
          }
        }}
        reorderMode={reorderMode}
        onToggleReorder={() => setReorderMode(r => !r)}
      />

      {/* Block picker bottom sheet */}
      <BlockInserter
        open={showInserter}
        onSelect={type => {
          const idx = inserterAt ?? blocks.length;
          insertBlock(type, idx);
        }}
        onClose={() => setShowInserter(false)}
      />
    </div>
  );
}
