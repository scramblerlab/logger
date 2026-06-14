import React, { useRef, useState } from 'react';

interface Props {
  src?: string;
  url?: string;
  caption?: string;
  pendingFile?: File;
  editSlug?: string;
  onChange: (patch: { src?: string; url?: string; caption?: string; pendingFile?: File }) => void;
  onFocus: () => void;
}

function getYouTubeId(url: string): string | null {
  const m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}

function getVimeoId(url: string): string | null {
  const m = url.match(/vimeo\.com\/(\d+)/);
  return m ? m[1] : null;
}

export default React.memo(function VideoBlock({ src, url, caption, pendingFile, editSlug, onChange, onFocus }: Props) {
  const [mode, setMode] = useState<'url' | 'file'>(url ? 'url' : 'file');
  const fileRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const handleFocus = () => {
    onFocus();
    setTimeout(() => wrapRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 300);
  };

  const ytId = url ? getYouTubeId(url) : null;
  const vimeoId = url ? getVimeoId(url) : null;
  const videoPreviewSrc = pendingFile ? URL.createObjectURL(pendingFile)
    : (src && editSlug ? `/static/articles/${editSlug}/${src}` : src ?? '');

  return (
    <div ref={wrapRef} className="space-y-2" onClick={handleFocus}>
      {/* Mode tabs */}
      <div className="flex gap-2 text-xs">
        <button
          type="button"
          onClick={() => setMode('url')}
          className={`px-2 py-1 rounded-full ${mode === 'url' ? 'bg-amber-500 text-black font-semibold' : 'text-slate-500 border border-rim2'}`}
        >URL</button>
        <button
          type="button"
          onClick={() => setMode('file')}
          className={`px-2 py-1 rounded-full ${mode === 'file' ? 'bg-amber-500 text-black font-semibold' : 'text-slate-500 border border-rim2'}`}
        >ファイル</button>
      </div>

      {mode === 'url' && (
        <div className="space-y-2">
          <input
            type="url"
            value={url ?? ''}
            onChange={e => onChange({ url: e.target.value || undefined, src: undefined })}
            onFocus={handleFocus}
            placeholder="YouTube / Vimeo URL..."
            className="w-full bg-surface2 border border-rim2 text-slate-100 text-sm rounded-lg px-3 py-2 outline-none focus:border-amber-500 placeholder-slate-600"
          />
          {ytId && (
            <div className="relative w-full" style={{ paddingBottom: '56.25%' }}>
              <iframe
                className="absolute inset-0 w-full h-full rounded-lg"
                src={`https://www.youtube.com/embed/${ytId}`}
                title="YouTube preview"
                allowFullScreen
              />
            </div>
          )}
          {vimeoId && (
            <div className="relative w-full" style={{ paddingBottom: '56.25%' }}>
              <iframe
                className="absolute inset-0 w-full h-full rounded-lg"
                src={`https://player.vimeo.com/video/${vimeoId}`}
                title="Vimeo preview"
                allowFullScreen
              />
            </div>
          )}
        </div>
      )}

      {mode === 'file' && (
        <>
          <input
            ref={fileRef}
            type="file"
            accept="video/*"
            className="hidden"
            onChange={e => {
              const f = e.target.files?.[0];
              if (f) onChange({ pendingFile: f, url: undefined });
            }}
          />
          {videoPreviewSrc ? (
            <div className="relative group">
              <video
                src={videoPreviewSrc}
                controls
                className="w-full rounded-lg max-h-64"
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
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.069A1 1 0 0121 8.82v6.36a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              <span className="text-sm">タップして動画を選択</span>
            </button>
          )}
        </>
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
});
