import { useRef, useEffect, useState } from 'react';
import { api } from '../api/client';
import type { ShopifyBlog } from '../types';

interface Creds {
  shopUrl: string;
  clientId: string;
  clientSecret: string;
  blogId: string;
  blogTitle: string;
}

interface Props {
  onConfirm: (creds: Creds) => void;
  onCancel: () => void;
}

const SK = 'shopify_creds';
function save(url: string, id: string) {
  localStorage.setItem(SK + '_url', url);
  localStorage.setItem(SK + '_id', id);
  // secret intentionally not persisted to localStorage
}

export default function ShopifyExportDialog({ onConfirm, onCancel }: Props) {
  const [shopUrl, setShopUrl] = useState(() => localStorage.getItem(SK + '_url') ?? '');
  const [clientId, setClientId] = useState(() => localStorage.getItem(SK + '_id') ?? '');
  const [clientSecret, setClientSecret] = useState('');
  const [connecting, setConnecting] = useState(false);
  const secretRef = useRef<HTMLInputElement>(null);

  // Auto-focus secret when url+id are pre-filled (secret is never persisted)
  useEffect(() => {
    if (shopUrl && clientId) secretRef.current?.focus();
  }, []);
  const [blogs, setBlogs] = useState<ShopifyBlog[] | null>(null);
  const [selectedBlogId, setSelectedBlogId] = useState('');

  const handleConnect = async () => {
    const shop = shopUrl.trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
    if (!shop || !clientId.trim() || !clientSecret.trim()) return;
    setConnecting(true);
    try {
      const res = await api.shopify.blogs(shop, clientId.trim(), clientSecret.trim());
      save(shop, clientId.trim());
      setBlogs(res.blogs);
      if (res.blogs.length > 0) setSelectedBlogId(res.blogs[0].id);
    } catch {
      alert('接続に失敗しました。ストアURL・クライアントID・シークレットを確認してください。');
    } finally {
      setConnecting(false);
    }
  };

  const handleConfirm = () => {
    const shop = shopUrl.trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
    const blog = blogs?.find((b) => b.id === selectedBlogId);
    if (!blog) return;
    onConfirm({ shopUrl: shop, clientId: clientId.trim(), clientSecret: clientSecret.trim(), blogId: blog.id, blogTitle: blog.title });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
      <div className="bg-[#0e0e14] border border-rim rounded-2xl p-6 w-full max-w-md shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-100">Shopifyにエクスポート</h2>
          <button onClick={onCancel} className="text-slate-500 hover:text-slate-300 transition-colors text-xl leading-none">✕</button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs text-slate-500 mb-1">ストアURL</label>
            <input
              type="text"
              value={shopUrl}
              onChange={(e) => setShopUrl(e.target.value)}
              placeholder="yourstore.myshopify.com"
              disabled={!!blogs}
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
              disabled={!!blogs}
              className="w-full bg-surface2 border border-rim2 text-slate-100 placeholder-slate-500 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 disabled:opacity-60 font-mono"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">
              シークレット
              <span className="ml-2 text-amber-500/70 font-normal normal-case">※ 毎回入力が必要です</span>
            </label>
            <input
              ref={secretRef}
              type="password"
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              placeholder="シークレットを入力"
              disabled={!!blogs}
              className="w-full bg-surface2 border border-rim2 text-slate-100 placeholder-slate-500 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 disabled:opacity-60 font-mono"
            />
          </div>

          {!blogs && (
            <button
              onClick={handleConnect}
              disabled={connecting || !shopUrl.trim() || !clientId.trim() || !clientSecret.trim()}
              className="w-full bg-surface2 hover:bg-rim disabled:opacity-50 text-slate-200 font-medium py-2 rounded-lg transition-colors text-sm border border-rim"
            >
              {connecting ? '接続中...' : '接続してブログを確認'}
            </button>
          )}

          {blogs && (
            <>
              <div>
                <label className="block text-xs text-slate-500 mb-1">エクスポート先ブログ</label>
                {blogs.length === 0 ? (
                  <p className="text-sm text-slate-400">このストアにブログがありません。</p>
                ) : (
                  <select
                    value={selectedBlogId}
                    onChange={(e) => setSelectedBlogId(e.target.value)}
                    className="w-full bg-surface2 border border-rim2 text-slate-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                  >
                    {blogs.map((b) => (
                      <option key={b.id} value={b.id}>{b.title} ({b.article_count}件)</option>
                    ))}
                  </select>
                )}
              </div>
              <button
                onClick={() => setBlogs(null)}
                className="text-xs text-slate-500 hover:text-amber-400 transition-colors"
              >
                ← 接続情報を変更
              </button>
            </>
          )}
        </div>

        <div className="flex gap-2 pt-2">
          <button
            onClick={handleConfirm}
            disabled={!blogs || !selectedBlogId}
            className="flex-1 bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-black font-bold py-2 rounded-full transition-colors text-sm"
          >
            エクスポートモードを開始
          </button>
          <button
            onClick={onCancel}
            className="px-4 py-2 bg-surface2 hover:bg-rim border border-rim text-slate-300 font-medium rounded-full transition-colors text-sm"
          >
            キャンセル
          </button>
        </div>

        <details className="text-xs text-slate-500">
          <summary className="cursor-pointer hover:text-slate-300 transition-colors select-none">
            クライアントID・シークレットの確認方法 ▸
          </summary>
          <ol className="mt-2 space-y-1 text-slate-500 pl-1">
            <li><span className="text-amber-600 font-bold mr-1">1.</span> <a href="https://dev.shopify.com" target="_blank" rel="noreferrer" className="text-amber-500 underline">dev.shopify.com</a> でアプリを作成または開く</li>
            <li><span className="text-amber-600 font-bold mr-1">2.</span> アプリ → <strong className="text-slate-400">設定</strong> → <strong className="text-slate-400">APIの設定</strong> でスコープ <code className="text-amber-500">write_content</code> を追加</li>
            <li><span className="text-amber-600 font-bold mr-1">3.</span> 設定ページの <strong className="text-slate-400">資格情報</strong> セクションからクライアントIDとシークレットをコピー</li>
            <li><span className="text-amber-600 font-bold mr-1">4.</span> ストアURLは <code className="text-slate-400">yourstore.myshopify.com</code> の形式で入力</li>
          </ol>
        </details>
      </div>
    </div>
  );
}
