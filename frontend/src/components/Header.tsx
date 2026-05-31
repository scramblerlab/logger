import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useAiJob } from '../context/AiJobContext';
import LoginModal from './LoginModal';

interface Props {
  onSearch: (q: string) => void;
}

export default function Header({ onSearch }: Props) {
  const [query, setQuery] = useState('');
  const [showLogin, setShowLogin] = useState(false);
  const navigate = useNavigate();
  const { isEditor, logout } = useAuth();
  const { status: aiStatus, currentTitle: aiTitle } = useAiJob();

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      navigate(`/?q=${encodeURIComponent(query.trim())}`);
      onSearch(query.trim());
    }
  };

  return (
    <>
      <header className="bg-surface border-b border-rim sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center gap-4">
          <Link to="/" className="font-display text-2xl tracking-widest text-amber-400 flex-shrink-0">
            logger
          </Link>
          <form onSubmit={handleSearch} className="flex-1 max-w-md">
            <div className="relative">
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="記事を検索 / Search articles..."
                className="w-full pl-9 pr-4 py-2 text-sm bg-surface2 border border-rim text-slate-100 placeholder-slate-500 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent"
              />
              <svg className="absolute left-2.5 top-2.5 w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
          </form>
          <nav className="ml-auto flex items-center gap-3">
            {aiStatus === 'running' && (
              <span className="hidden sm:flex items-center gap-1.5 text-xs text-amber-400 animate-pulse">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0" />
                {aiTitle ? `AI: 「${aiTitle}」` : 'AI分析中...'}
              </span>
            )}
            {aiStatus === 'done' && (
              <span className="hidden sm:inline text-xs text-emerald-400">✓ AI分類完了</span>
            )}
            {isEditor ? (
              <>
                <Link
                  to="/write"
                  className="inline-flex items-center gap-1.5 bg-amber-500 hover:bg-amber-400 text-black text-sm font-semibold px-4 py-2 rounded-full transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  投稿 / Write
                </Link>
                <button
                  onClick={() => logout()}
                  className="text-sm text-slate-500 hover:text-slate-300 px-3 py-2 transition-colors"
                >
                  ログアウト
                </button>
              </>
            ) : (
              <button
                onClick={() => setShowLogin(true)}
                className="inline-flex items-center gap-1.5 bg-surface2 hover:bg-rim border border-rim text-slate-300 text-sm font-semibold px-4 py-2 rounded-full transition-colors"
              >
                ログイン
              </button>
            )}
          </nav>
        </div>
      </header>
      {showLogin && <LoginModal onClose={() => setShowLogin(false)} />}
    </>
  );
}
