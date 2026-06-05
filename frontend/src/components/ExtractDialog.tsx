import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';

interface Props {
  onClose: () => void;
}

export default function ExtractDialog({ onClose }: Props) {
  const navigate = useNavigate();
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = await api.extract.url({ url: url.trim() });
      onClose();
      navigate('/write', { state: { extraction: data } });
    } catch (err) {
      setError(err instanceof Error ? err.message : '抽出に失敗しました。URLを確認してください。');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-surface ring-1 ring-rim rounded-2xl p-8 w-full max-w-lg shadow-2xl">
        <h2 className="font-display text-3xl tracking-wide text-slate-100 mb-2">Web記事抽出</h2>
        <p className="text-sm text-slate-500 mb-6">URLを入力すると、記事タイトル・本文・画像を自動で取り込みます。</p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-400 mb-1">記事URL</label>
            <input
              type="url"
              required
              autoFocus
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/article/..."
              className="w-full bg-surface2 border border-rim2 text-slate-100 placeholder-slate-500 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent"
            />
          </div>
          {error && <p className="text-sm text-red-400">{error}</p>}
          {loading && (
            <div className="flex items-center gap-2 text-sm text-amber-400">
              <div className="w-4 h-4 border-2 border-amber-500 border-t-transparent rounded-full animate-spin flex-shrink-0" />
              記事を取得中... 画像ダウンロードに少し時間がかかる場合があります。
            </div>
          )}
          <button
            type="submit"
            disabled={loading || !url.trim()}
            className="w-full bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black font-bold py-2.5 rounded-full transition-colors"
          >
            {loading ? '抽出中...' : '抽出'}
          </button>
        </form>
        <button
          onClick={onClose}
          className="mt-3 w-full text-sm text-slate-500 hover:text-slate-300 transition-colors py-1"
        >
          キャンセル
        </button>
      </div>
    </div>
  );
}
