import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';

interface ArticleRef {
  title: string;
  slug: string;
}

interface Props {
  onClose: () => void;
}

export default function AskAiDialog({ onClose }: Props) {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [articles, setArticles] = useState<ArticleRef[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!question.trim() || loading) return;
    setError('');
    setAnswer('');
    setArticles([]);
    setLoading(true);
    try {
      const res = await api.ai.ask(question.trim());
      setAnswer(res.answer);
      setArticles(res.articles);
    } catch {
      setError('エラーが発生しました。もう一度お試しください。');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      handleSubmit();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-surface ring-1 ring-rim rounded-2xl w-full max-w-xl shadow-2xl mx-4 flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4 flex-shrink-0">
          <h2 className="font-display text-2xl tracking-wide text-slate-100">AIに訊く</h2>
          <button
            onClick={onClose}
            className="text-slate-500 hover:text-slate-300 transition-colors text-xl leading-none"
            aria-label="閉じる"
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className="px-6 pt-2 pb-6 flex flex-col gap-4 overflow-y-auto">
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <textarea
              ref={textareaRef}
              autoFocus
              rows={4}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="何でも訊いてください… (Ctrl+Enter で送信)"
              className="w-full bg-surface2 border border-rim2 text-slate-100 placeholder-slate-500 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent resize-none"
            />
            <button
              type="submit"
              disabled={loading || !question.trim()}
              className="self-end bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black font-bold px-5 py-2 rounded-full transition-colors text-sm"
            >
              {loading ? '⏳ 送信中...' : '送信'}
            </button>
          </form>

          {error && (
            <p className="text-sm text-red-400">{error}</p>
          )}

          {answer && (
            <div className="flex flex-col gap-3">
              <div className="border-t border-rim pt-4">
                <p className="text-xs text-slate-500 mb-2 font-medium uppercase tracking-wide">回答</p>
                <p className="text-sm text-slate-200 whitespace-pre-wrap leading-relaxed">{answer}</p>
              </div>

              {articles.length > 0 && (
                <div>
                  <p className="text-xs text-slate-500 mb-2 font-medium uppercase tracking-wide">関連記事</p>
                  <div className="flex flex-wrap gap-2">
                    {articles.map((a) => (
                      <Link
                        key={a.slug}
                        to={`/articles/${a.slug}`}
                        onClick={onClose}
                        className="text-xs px-2.5 py-1 rounded-full bg-surface2 border border-rim text-amber-400 hover:bg-rim transition-colors"
                      >
                        {a.title}
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
