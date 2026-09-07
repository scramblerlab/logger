import { Link } from 'react-router-dom';
import { useAiJob } from '../context/AiJobContext';
import { usePushNotification } from '../hooks/usePushNotification';

interface Props {
  onClose: () => void;
  onBulkCategorize: () => void;
  onShopifyExport: () => void;
}

const rowCls = 'flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm text-slate-300 hover:bg-surface2 transition-colors text-left';

/**
 * Editor-only hub for every action that used to be scattered across the
 * sidebar, the mobile button row and the article list header.
 */
export default function BulkActionsModal({ onClose, onBulkCategorize, onShopifyExport }: Props) {
  const {
    status: aiStatus, progress: aiProgress, startJob,
    commentStatus, commentProgress, startCommentJob,
  } = useAiJob();
  const {
    supported: pushSupported, permission: pushPermission,
    subscribed: pushSubscribed, loading: pushLoading,
    subscribe: pushSubscribe, unsubscribe: pushUnsubscribe,
  } = usePushNotification();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={onClose}>
      <div
        className="bg-surface rounded-2xl shadow-2xl w-full max-w-md mx-4 max-h-[90vh] flex flex-col ring-1 ring-rim"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-rim">
          <h2 className="text-base font-semibold text-slate-100">バルク操作</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-100 text-xl leading-none transition-colors">×</button>
        </div>

        <div className="overflow-y-auto flex-1 px-3 py-3 space-y-4">

          {/* ── AI ─────────────────────────────────────────────────── */}
          <div>
            <p className="px-2 text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">AI</p>

            <button onClick={startJob} disabled={aiStatus === 'running'} className={`${rowCls} disabled:opacity-50`}>
              <span className="text-amber-400">✦</span>
              <span className="flex-1">AIカテゴリー分析</span>
              <span className="text-xs text-slate-500">{aiStatus === 'running' ? '実行中' : '実行'}</span>
            </button>
            {aiStatus !== 'idle' && aiProgress && (
              <p className="px-3 pb-1.5 text-xs text-amber-400">{aiProgress}</p>
            )}

            <button onClick={startCommentJob} disabled={commentStatus === 'running'} className={`${rowCls} disabled:opacity-50`}>
              <span className="text-amber-400">✦</span>
              <span className="flex-1">AIコメント</span>
              <span className="text-xs text-slate-500">{commentStatus === 'running' ? '実行中' : '実行'}</span>
            </button>
            {commentStatus !== 'idle' && commentProgress && (
              <p className="px-3 pb-1.5 text-xs text-amber-400">{commentProgress}</p>
            )}

            {pushSupported && pushPermission !== 'denied' && (
              <button
                onClick={pushSubscribed ? pushUnsubscribe : pushSubscribe}
                disabled={pushLoading}
                className={`${rowCls} disabled:opacity-50`}
              >
                <span>{pushSubscribed ? '🔔' : '🔕'}</span>
                <span className="flex-1">AI完了通知</span>
                <span
                  className="text-xs font-semibold"
                  style={{ color: pushSubscribed ? '#f59e0b' : '#94a3b8' }}
                >
                  {pushLoading ? '...' : pushSubscribed ? 'ON' : 'OFF'}
                </span>
              </button>
            )}
          </div>

          {/* ── Articles ───────────────────────────────────────────── */}
          <div className="border-t border-rim pt-3">
            <p className="px-2 text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">記事</p>
            <button onClick={() => { onClose(); onBulkCategorize(); }} className={rowCls}>
              <span>📁</span>
              <span className="flex-1">カテゴリー一括更新</span>
              <span className="text-xs text-slate-500">開始</span>
            </button>
          </div>

          {/* ── Import / export ────────────────────────────────────── */}
          <div className="border-t border-rim pt-3">
            <p className="px-2 text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">インポート / エクスポート</p>
            <Link to="/import" onClick={onClose} className={rowCls}>
              <span>⬇</span>
              <span className="flex-1">WordPress一括インポート</span>
            </Link>
            <Link to="/import/shopify" onClick={onClose} className={rowCls}>
              <span>⬇</span>
              <span className="flex-1">Shopifyブログ一括インポート</span>
            </Link>
            <button onClick={() => { onClose(); onShopifyExport(); }} className={rowCls}>
              <span>⬆</span>
              <span className="flex-1">Shopifyブログにエクスポート</span>
            </button>
          </div>

        </div>
      </div>
    </div>
  );
}
