import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import type { ImportAnalyzeResponse } from '../types';

interface ProgressEvent {
  done?: number; total?: number; current?: string;
  saved?: string; error?: string; finished?: boolean; imported?: number;
}

const PRESET_URLS = [
  { label: 'Bike',      url: 'https://www.scrambler-lab.com/bike/' },
  { label: 'Onsen',     url: 'https://www.scrambler-lab.com/onsen/' },
  { label: 'Sentou',    url: 'https://www.scrambler-lab.com/sentou/' },
  { label: 'Container', url: 'https://www.scrambler-lab.com/container/' },
  { label: 'Cooking',   url: 'https://www.scrambler-lab.com/cooking/' },
  { label: 'Lens',      url: 'https://www.scrambler-lab.com/lens/' },
];

export default function ImportPage() {
  const [url, setUrl] = useState('');
  const [analysis, setAnalysis] = useState<ImportAnalyzeResponse | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<ProgressEvent | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [done, setDone] = useState(false);

  const handleAnalyze = async () => {
    if (!url.trim()) return;
    setAnalyzing(true); setAnalysis(null);
    try {
      setAnalysis(await api.importer.analyze(url.trim()));
    } catch {
      alert('分析に失敗しました。URLを確認してください。');
    } finally {
      setAnalyzing(false);
    }
  };

  const handleImport = () => {
    if (!url.trim() || running) return;
    setRunning(true); setDone(false); setLog([]); setProgress(null);

    fetch('/api/import/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: url.trim(), auto_classify: true }),
    }).then((res) => {
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      const pump = () => reader.read().then(({ done: sd, value }) => {
        if (sd) { setRunning(false); return; }
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n'); buf = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6).trim();
          if (raw === '[DONE]') { setRunning(false); setDone(true); return; }
          try {
            const ev: ProgressEvent = JSON.parse(raw);
            setProgress(ev);
            if (ev.saved) setLog((p) => [`✓ ${ev.saved}`, ...p].slice(0, 100));
            if (ev.error) setLog((p) => [`✗ ${ev.error}`, ...p].slice(0, 100));
            if (ev.finished) { setDone(true); setRunning(false); return; }
          } catch {}
        }
        pump();
      }).catch(() => setRunning(false));
      pump();
    }).catch(() => { setRunning(false); alert('インポートに失敗しました。'); });
  };

  const progressPct = progress?.total ? Math.round(((progress.done ?? 0) / progress.total) * 100) : 0;

  return (
    <div className="max-w-2xl mx-auto px-4 py-10">
      <Link to="/" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-indigo-400 mb-6 transition-colors">
        ← 一覧に戻る
      </Link>
      <h2 className="text-2xl font-bold text-gray-100 mb-2">一括インポート</h2>
      <p className="text-sm text-gray-500 mb-8">WordPressサイトから記事を一括インポートします。REST API / サイトマップ / スクレイピングで自動取得します。</p>

      {/* Preset URLs */}
      <div className="flex flex-wrap gap-2 mb-4">
        {PRESET_URLS.map((p) => (
          <button key={p.label} onClick={() => setUrl(p.url)}
            className="text-xs px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 font-medium border border-gray-600 transition-colors"
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="flex gap-2 mb-4">
        <input
          type="url" value={url} onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com/category/"
          className="flex-1 bg-gray-800 border border-gray-600 text-gray-100 placeholder-gray-500 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <button onClick={handleAnalyze} disabled={analyzing || !url.trim()}
          className="px-4 py-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-gray-200 text-sm font-medium rounded-lg transition-colors border border-gray-600"
        >
          {analyzing ? '分析中...' : '分析'}
        </button>
      </div>

      {analysis && (
        <div className="bg-gray-800 ring-1 ring-indigo-500/40 rounded-xl p-5 mb-6 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-gray-100">分析結果</h3>
            <span className="text-xs text-indigo-400 bg-indigo-500/20 px-2 py-0.5 rounded">{analysis.method}</span>
          </div>
          <p className="text-sm text-gray-300">約 <span className="font-bold text-indigo-400">{analysis.article_count}</span> 件の記事を検出</p>
          {analysis.sample_titles.length > 0 && (
            <div>
              <p className="text-xs text-gray-500 mb-1">サンプル記事:</p>
              <ul className="text-sm text-gray-400 space-y-0.5">
                {analysis.sample_titles.map((t, i) => <li key={i} className="truncate">• {t}</li>)}
              </ul>
            </div>
          )}
          <button onClick={handleImport} disabled={running}
            className="w-full mt-2 bg-indigo-500 hover:bg-indigo-400 disabled:opacity-50 text-white font-medium py-2.5 rounded-lg transition-colors text-sm"
          >
            {running ? 'インポート中...' : `インポート開始 (${analysis.article_count}件)`}
          </button>
        </div>
      )}

      {running && (
        <div className="mb-6">
          <div className="flex items-center justify-between text-sm text-gray-400 mb-2">
            <span>{progress?.current ? `処理中: ${progress.current}` : 'インポート中...'}</span>
            <span>{progress?.done ?? 0} / {progress?.total ?? '?'}</span>
          </div>
          <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
            <div className="h-full bg-indigo-500 rounded-full transition-all duration-300" style={{ width: `${progressPct}%` }} />
          </div>
        </div>
      )}

      {done && (
        <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-4 mb-6 text-sm text-green-400 font-medium">
          ✓ インポート完了！ {progress?.imported ?? log.filter(l => l.startsWith('✓')).length} 件を保存しました。
          <Link to="/" className="ml-3 text-indigo-400 hover:underline">一覧を見る →</Link>
        </div>
      )}

      {log.length > 0 && (
        <div className="bg-gray-950 text-gray-300 rounded-xl p-4 text-xs font-mono max-h-64 overflow-y-auto space-y-0.5 ring-1 ring-gray-700">
          {log.map((l, i) => (
            <div key={i} className={l.startsWith('✗') ? 'text-red-400' : 'text-green-400'}>{l}</div>
          ))}
        </div>
      )}
    </div>
  );
}
