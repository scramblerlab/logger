import { useState } from 'react';

interface ProgressEvent {
  done?: number; total?: number; current?: string;
  saved?: string; error?: string; finished?: boolean; exported?: number; failed?: number;
}

interface Props {
  selectedCount: number;
  totalCount: number;
  shopUrl: string;
  blogId: string;
  clientId: string;
  clientSecret: string;
  selectedSlugs: string[];
  onSelectAll: () => void;
  onClearSelection: () => void;
  onDone: () => void;
  onCancel: () => void;
}

export default function ShopifyExportPanel({
  selectedCount, shopUrl, blogId, clientId, clientSecret, selectedSlugs,
  onSelectAll, onClearSelection, onDone, onCancel,
}: Props) {
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState<ProgressEvent | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [done, setDone] = useState(false);

  const handleExport = () => {
    if (selectedSlugs.length === 0 || exporting) return;
    setExporting(true); setLog([]); setProgress(null); setDone(false);

    fetch('/api/shopify/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        shop_url: shopUrl,
        client_id: clientId,
        client_secret: clientSecret,
        blog_id: blogId,
        article_slugs: selectedSlugs,
      }),
    }).then((res) => {
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      const pump = () => reader.read().then(({ done: sd, value }) => {
        if (sd) { setExporting(false); return; }
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n'); buf = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6).trim();
          if (raw === '[DONE]') { setExporting(false); setDone(true); return; }
          try {
            const ev: ProgressEvent = JSON.parse(raw);
            setProgress(ev);
            if (ev.saved) setLog((p) => [`✓ ${ev.saved}`, ...p].slice(0, 100));
            if (ev.error) setLog((p) => [`✗ ${ev.error}`, ...p].slice(0, 100));
            if (ev.finished) { setDone(true); setExporting(false); return; }
          } catch {}
        }
        pump();
      }).catch(() => setExporting(false));
      pump();
    }).catch(() => { setExporting(false); alert('エクスポートに失敗しました。'); });
  };

  const progressPct = progress?.total ? Math.round(((progress.done ?? 0) / progress.total) * 100) : 0;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 bg-[#0e0e14] border-t border-rim shadow-2xl">
      {/* Progress bar */}
      {exporting && (
        <div className="h-1 bg-surface2">
          <div className="h-full bg-amber-500 transition-all duration-300" style={{ width: `${progressPct}%` }} />
        </div>
      )}

      <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-3 flex-wrap sm:flex-nowrap">
        {/* Selection controls */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-sm font-semibold text-slate-100 whitespace-nowrap">
            {selectedCount}件選択中
          </span>
          <button onClick={onSelectAll} className="text-xs text-amber-400 hover:text-amber-300 transition-colors whitespace-nowrap">全選択</button>
          <button onClick={onClearSelection} className="text-xs text-slate-500 hover:text-slate-300 transition-colors whitespace-nowrap">解除</button>
        </div>

        <div className="hidden sm:block w-px h-5 bg-rim flex-shrink-0" />

        {/* Store info */}
        <div className="flex-1 min-w-0 overflow-hidden">
          {exporting && progress?.current ? (
            <p className="text-xs text-slate-400 truncate">処理中: {progress.current} ({progress.done ?? 0}/{progress.total ?? '?'})</p>
          ) : done ? (
            <p className="text-xs text-green-400">
              ✓ エクスポート完了 {log.filter((l) => l.startsWith('✓')).length}件
              {log.filter((l) => l.startsWith('✗')).length > 0 && (
                <span className="text-red-400 ml-2">✗ {log.filter((l) => l.startsWith('✗')).length}件失敗</span>
              )}
            </p>
          ) : (
            <p className="text-xs text-slate-500 truncate">
              <span className="text-slate-400">Shopify:</span> {shopUrl}
            </p>
          )}
        </div>

        <div className="hidden sm:block w-px h-5 bg-rim flex-shrink-0" />

        {/* Action buttons */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {done ? (
            <button
              onClick={onDone}
              className="text-sm px-4 py-1.5 rounded-full bg-green-600 hover:bg-green-500 text-white font-bold transition-colors"
            >
              完了
            </button>
          ) : (
            <button
              onClick={handleExport}
              disabled={selectedCount === 0 || exporting}
              className="text-sm px-4 py-1.5 rounded-full bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-black font-bold transition-colors whitespace-nowrap"
            >
              {exporting ? 'エクスポート中...' : 'Shopifyにエクスポート'}
            </button>
          )}
          <button
            onClick={onCancel}
            disabled={exporting}
            className="text-sm px-3 py-1.5 rounded-full bg-surface2 hover:bg-rim border border-rim text-slate-300 font-medium transition-colors disabled:opacity-40"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Export log */}
      {log.length > 0 && (
        <div className="max-w-7xl mx-auto px-4 pb-2">
          <div className="bg-[#050508] rounded-lg p-2 text-xs font-mono max-h-24 overflow-y-auto space-y-0.5 ring-1 ring-rim">
            {log.map((l, i) => (
              <div key={i} className={l.startsWith('✗') ? 'text-red-400' : 'text-green-400'}>{l}</div>
            ))}
          </div>
        </div>
      )}

      {/* Hint */}
      {!exporting && !done && (
        <div className="max-w-7xl mx-auto px-4 pb-2">
          <p className="text-xs text-slate-600">カテゴリーは <code>cat:X</code> タグとして Shopify に書き込まれます</p>
        </div>
      )}
    </div>
  );
}
