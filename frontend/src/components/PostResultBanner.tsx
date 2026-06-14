interface SuccessInfo {
  slug: string;
  bodySizeBytes: number;
  blockCount: number;
  publishedAt?: string;
}

interface Props {
  success?: SuccessInfo;
  error?: string;
  onContinueEditing: () => void;
  onViewArticle: () => void;
  onGoToList: () => void;
  onRetry?: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function formatDate(iso?: string): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('ja-JP', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return iso; }
}

export default function PostResultBanner({
  success, error, onContinueEditing, onViewArticle, onGoToList, onRetry,
}: Props) {
  if (!success && !error) return null;

  const isSuccess = !!success;

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70" onClick={isSuccess ? onContinueEditing : undefined} />

      {/* Sheet */}
      <div className="relative bg-surface rounded-t-2xl overflow-hidden">
        {/* Status header */}
        <div className={`px-5 py-4 flex items-center gap-3 ${isSuccess ? 'bg-green-950/60 border-b border-green-900/40' : 'bg-red-950/60 border-b border-red-900/40'}`}>
          <span className={`text-2xl ${isSuccess ? 'text-green-400' : 'text-red-400'}`}>
            {isSuccess ? '✓' : '✕'}
          </span>
          <div>
            <p className={`font-semibold text-base ${isSuccess ? 'text-green-300' : 'text-red-300'}`}>
              {isSuccess ? '更新が完了しました' : '投稿に失敗しました'}
            </p>
            {error && <p className="text-xs text-red-400 mt-0.5">{error}</p>}
          </div>
        </div>

        {/* Success details */}
        {isSuccess && success && (
          <div className="px-5 py-4 space-y-2.5">
            <div className="flex flex-col gap-0.5">
              <span className="text-xs text-slate-500 uppercase tracking-wide">URL</span>
              <span className="text-sm text-slate-300 font-mono break-all">/articles/{success.slug}</span>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <p className="text-xs text-slate-500">ページサイズ</p>
                <p className="text-sm text-slate-200 font-semibold">{formatBytes(success.bodySizeBytes)}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">ブロック数</p>
                <p className="text-sm text-slate-200 font-semibold">{success.blockCount}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">公開日時</p>
                <p className="text-sm text-slate-200 font-semibold">{formatDate(success.publishedAt)}</p>
              </div>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="px-5 pb-6 space-y-2">
          {isSuccess ? (
            <>
              <button
                type="button"
                onClick={onViewArticle}
                className="btn btn-solid w-full justify-center"
              >
                記事を表示する
              </button>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={onContinueEditing}
                  className="btn btn-outline flex-1 justify-center"
                >
                  編集を続ける
                </button>
                <button
                  type="button"
                  onClick={onGoToList}
                  className="btn btn-outline flex-1 justify-center"
                >
                  一覧へ戻る
                </button>
              </div>
            </>
          ) : (
            <div className="flex gap-3">
              {onRetry && (
                <button
                  type="button"
                  onClick={onRetry}
                  className="btn btn-solid flex-1 justify-center"
                >
                  再試行する
                </button>
              )}
              <button
                type="button"
                onClick={onContinueEditing}
                className="btn btn-outline flex-1 justify-center"
              >
                編集に戻る
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
