import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import type { ShopifyBlog } from '../types';
import { useAuth } from '../context/AuthContext';

interface ProgressEvent {
  done?: number; total?: number; current?: string;
  saved?: string; error?: string; finished?: boolean; imported?: number;
}

export default function ShopifyImportPage() {
  const navigate = useNavigate();
  const { isEditor, isLoading } = useAuth();
  useEffect(() => {
    if (!isLoading && !isEditor) navigate('/');
  }, [isLoading, isEditor, navigate]);

  // Step 1 — credentials (url + id persisted; secret not stored for security)
  const SK = 'shopify_creds';
  const [shopUrl, setShopUrl] = useState(() => localStorage.getItem(SK + '_url') ?? '');
  const [clientId, setClientId] = useState(() => localStorage.getItem(SK + '_id') ?? '');
  const [clientSecret, setClientSecret] = useState('');
  const [connecting, setConnecting] = useState(false);
  const secretRef = useRef<HTMLInputElement>(null);

  // Auto-focus secret when url+id are pre-filled (secret is never persisted)
  useEffect(() => {
    if (shopUrl && clientId) secretRef.current?.focus();
  }, []);

  // Step 2 — blog selection
  const [blogs, setBlogs] = useState<ShopifyBlog[] | null>(null);
  const [selectedBlogId, setSelectedBlogId] = useState('');
  const [limit, setLimit] = useState('');

  // Step 3 — import progress
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<ProgressEvent | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [done, setDone] = useState(false);

  const handleConnect = async () => {
    const shop = shopUrl.trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
    if (!shop || !clientId.trim() || !clientSecret.trim()) return;
    setConnecting(true);
    setBlogs(null);
    try {
      const res = await api.shopify.blogs(shop, clientId.trim(), clientSecret.trim());
      localStorage.setItem(SK + '_url', shop);
      localStorage.setItem(SK + '_id', clientId.trim());
      setBlogs(res.blogs);
      if (res.blogs.length > 0) setSelectedBlogId(res.blogs[0].id);
    } catch {
      alert('接続に失敗しました。ストアURL・クライアントID・シークレットを確認してください。');
    } finally {
      setConnecting(false);
    }
  };

  const handleImport = () => {
    if (!selectedBlogId || running) return;
    const shop = shopUrl.trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
    setRunning(true); setDone(false); setLog([]); setProgress(null);
    fetch('/api/shopify/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        shop_url: shop,
        client_id: clientId.trim(),
        client_secret: clientSecret.trim(),
        blog_id: selectedBlogId,
        limit: limit ? parseInt(limit, 10) : null,
        auto_classify: false,
      }),
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

  const selectedBlog = blogs?.find((b) => b.id === selectedBlogId);
  const progressPct = progress?.total ? Math.round(((progress.done ?? 0) / progress.total) * 100) : 0;

  return (
    <div className="max-w-2xl mx-auto px-4 py-10">
      <Link to="/" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-amber-400 mb-6 transition-colors">
        ← 一覧に戻る
      </Link>
      <h2 className="font-display text-4xl tracking-wide text-slate-100 mb-2">Shopifyブログ一括インポート</h2>
      <p className="text-sm text-slate-500 mb-4">
        Shopifyストアのブログ記事を一括インポートします。
      </p>

      {/* How to get credentials */}
      <div className="bg-surface2 border border-rim rounded-xl p-4 mb-8 text-sm">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">クライアントID・シークレットの確認方法</p>
        <ol className="space-y-1 text-slate-400 text-xs list-none">
          <li><span className="text-amber-500 font-bold mr-1">1.</span> <a href="https://dev.shopify.com" target="_blank" rel="noreferrer" className="text-amber-400 underline">dev.shopify.com</a> でアプリを作成または既存のアプリを開く</li>
          <li><span className="text-amber-500 font-bold mr-1">2.</span> アプリ → <strong className="text-slate-300">設定</strong> → <strong className="text-slate-300">APIの設定</strong> タブで <code className="text-amber-400 bg-black/30 px-1 rounded">read_content</code> スコープを追加</li>
          <li><span className="text-amber-500 font-bold mr-1">3.</span> 同じ設定ページ上部の <strong className="text-slate-300">資格情報</strong> セクションから <strong className="text-slate-300">クライアントID</strong> と <strong className="text-slate-300">シークレット</strong> をコピー</li>
          <li><span className="text-amber-500 font-bold mr-1">4.</span> ストアURLは <code className="text-slate-400 bg-black/30 px-1 rounded">yourstore.myshopify.com</code> の形式</li>
        </ol>
        <p className="mt-2 text-slate-600 text-xs">※ トークンは24時間有効で自動取得されます。静的なアクセストークンは不要です。</p>
      </div>

      {/* Step 1 — Connection */}
      <div className="space-y-3 mb-6">
        <div>
          <label className="block text-xs text-slate-500 mb-1">ストアURL</label>
          <input
            type="text"
            value={shopUrl}
            onChange={(e) => setShopUrl(e.target.value)}
            placeholder="yourstore.myshopify.com"
            disabled={!!blogs || running}
            className="w-full bg-surface2 border border-rim2 text-slate-100 placeholder-slate-500 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 disabled:opacity-60"
          />
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">クライアントID</label>
          <input
            type="text"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            placeholder="9553e37349a650063654f8faf112a936"
            disabled={!!blogs || running}
            className="w-full bg-surface2 border border-rim2 text-slate-100 placeholder-slate-500 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 disabled:opacity-60 font-mono"
          />
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">
            シークレット
            <span className="ml-2 text-amber-500/70 font-normal">※ 毎回入力が必要です</span>
          </label>
          <input
            ref={secretRef}
            type="password"
            value={clientSecret}
            onChange={(e) => setClientSecret(e.target.value)}
            placeholder="シークレットを入力"
            disabled={!!blogs || running}
            className="w-full bg-surface2 border border-rim2 text-slate-100 placeholder-slate-500 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 disabled:opacity-60 font-mono"
          />
        </div>
        {!blogs && (
          <button
            onClick={handleConnect}
            disabled={connecting || !shopUrl.trim() || !clientId.trim() || !clientSecret.trim()}
            className="w-full bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black font-bold text-sm py-2 rounded-full transition-colors"
          >
            {connecting ? '接続中...' : '接続してブログを確認'}
          </button>
        )}
        {blogs && !running && !done && (
          <button
            onClick={() => { setBlogs(null); setSelectedBlogId(''); }}
            className="text-xs text-slate-500 hover:text-amber-400 transition-colors"
          >
            ← 接続情報を変更
          </button>
        )}
      </div>

      {/* Step 2 — Blog selection */}
      {blogs && !running && !done && (
        <div className="bg-surface ring-1 ring-amber-500/40 rounded-xl p-5 mb-6 space-y-4">
          <h3 className="font-semibold text-slate-100">ブログを選択</h3>
          {blogs.length === 0 ? (
            <p className="text-sm text-slate-400">このストアにブログがありません。</p>
          ) : (
            <div className="space-y-2">
              {blogs.map((blog) => (
                <label key={blog.id} className="flex items-center gap-3 cursor-pointer group">
                  <input
                    type="radio"
                    name="blog"
                    value={blog.id}
                    checked={selectedBlogId === blog.id}
                    onChange={() => setSelectedBlogId(blog.id)}
                    className="accent-amber-500"
                  />
                  <span className="text-sm text-slate-200 group-hover:text-amber-400 transition-colors">
                    {blog.title}
                    <span className="ml-2 text-xs text-slate-500">({blog.article_count}件)</span>
                  </span>
                </label>
              ))}
            </div>
          )}
          <div>
            <label className="block text-xs text-slate-500 mb-1">件数制限（空白 = 全件）</label>
            <input
              type="number"
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
              placeholder="例: 100"
              min="1"
              className="w-36 bg-surface2 border border-rim2 text-slate-100 placeholder-slate-500 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
          </div>
          <button
            onClick={handleImport}
            disabled={!selectedBlogId || running}
            className="w-full bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black font-bold text-sm py-2 rounded-full transition-colors"
          >
            インポート開始 ({selectedBlog?.article_count ?? 0}件)
          </button>
        </div>
      )}

      {/* Step 3 — Progress */}
      {running && (
        <div className="mb-6">
          <div className="flex items-center justify-between text-sm text-slate-400 mb-2">
            <span>{progress?.current ? `処理中: ${progress.current}` : 'インポート中...'}</span>
            <span>{progress?.done ?? 0} / {progress?.total ?? '?'}</span>
          </div>
          <div className="h-2 bg-surface2 rounded-full overflow-hidden">
            <div className="h-full bg-amber-500 rounded-full transition-all duration-300" style={{ width: `${progressPct}%` }} />
          </div>
        </div>
      )}

      {done && (
        <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-4 mb-6 text-sm text-green-400 font-medium">
          ✓ インポート完了！ {log.filter((l) => l.startsWith('✓')).length} 件を保存しました。
          <span className="block mt-1 text-xs text-green-300 font-normal">AI分類はバックグラウンドで自動的に開始されます。</span>
          <Link to="/" className="mt-2 inline-block text-amber-400 hover:underline">一覧を見る →</Link>
        </div>
      )}

      {log.length > 0 && (
        <div className="bg-[#050508] text-slate-300 rounded-xl p-4 text-xs font-mono max-h-64 overflow-y-auto space-y-0.5 ring-1 ring-rim">
          {log.map((l, i) => (
            <div key={i} className={l.startsWith('✗') ? 'text-red-400' : 'text-green-400'}>{l}</div>
          ))}
        </div>
      )}
    </div>
  );
}
