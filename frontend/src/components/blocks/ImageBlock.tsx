import { useRef } from 'react';

interface Props {
  src: string;
  caption?: string;
  rotation?: 0 | 90 | 180 | 270;
  pendingFile?: File;
  editSlug?: string;
  onChange: (patch: { src?: string; caption?: string; pendingFile?: File }) => void;
  onFocus: () => void;
}

export default function ImageBlock({ src, caption, rotation, pendingFile, editSlug, onChange, onFocus }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const previewUrl = pendingFile
    ? URL.createObjectURL(pendingFile)
    : (src
      ? (src.startsWith('http') || src.startsWith('/')
        ? src                                               // absolute URL or absolute path — use as-is
        : (editSlug ? `/static/articles/${editSlug}/${src}` : ''))  // relative path from new editor
      : '');

  const handleFocus = () => {
    onFocus();
    setTimeout(() => wrapRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 300);
  };

  const handleFile = (file: File) => {
    if (editSlug) {
      // In edit mode, the parent (BlockEditor) handles upload; just track pending
      onChange({ pendingFile: file, src: '' });
    } else {
      onChange({ pendingFile: file, src: '' });
    }
  };

  return (
    <div ref={wrapRef} className="space-y-2" onClick={handleFocus}>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
      />
      {previewUrl ? (
        <div className="relative group overflow-hidden rounded-lg">
          <img
            src={previewUrl}
            alt={caption ?? ''}
            className="w-full object-cover max-h-80"
            style={rotation ? { transform: `rotate(${rotation}deg)`, transformOrigin: 'center center' } : undefined}
          />
          <button
            type="button"
            onClick={e => { e.stopPropagation(); fileRef.current?.click(); }}
            className="absolute top-2 right-2 bg-black/60 text-white text-xs px-2 py-1 rounded-lg opacity-0 group-hover:opacity-100 active:opacity-100 transition-opacity"
          >
            変更
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={e => { e.stopPropagation(); fileRef.current?.click(); }}
          className="w-full h-40 border-2 border-dashed border-rim2 rounded-lg flex flex-col items-center justify-center text-slate-600 hover:border-amber-500 active:border-amber-500 transition-colors"
        >
          <svg className="w-8 h-8 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          <span className="text-sm">タップして画像を選択</span>
        </button>
      )}
      <input
        type="text"
        value={caption ?? ''}
        onChange={e => onChange({ caption: e.target.value || undefined })}
        onFocus={handleFocus}
        placeholder="キャプション（任意）..."
        className="w-full bg-transparent text-sm text-slate-500 outline-none placeholder-slate-700"
      />
    </div>
  );
}
