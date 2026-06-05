import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useAiJob } from '../context/AiJobContext';
import { useTranslation } from '../context/TranslationContext';
import TranslateButton from './TranslateButton';
import ExtractDialog from './ExtractDialog';

interface Props {
  onSearch: (q: string) => void;
}

export default function Header({ onSearch }: Props) {
  const [query, setQuery] = useState('');
  const [showExtract, setShowExtract] = useState(false);
  const navigate = useNavigate();
  const { isEditor } = useAuth();
  const { status: aiStatus, currentTitle: aiTitle } = useAiJob();
  const { translating, translated, triggerTranslate, triggerReset } = useTranslation();

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      navigate(`/?q=${encodeURIComponent(query.trim())}`);
      onSearch(query.trim());
    }
  };

  return (
    <header className="bg-surface border-b border-rim sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4 h-16 flex items-center gap-4">
        <Link to="/" className="font-display text-xl tracking-wide text-amber-400 flex-shrink-0">
          GENERATIVE LOGGER
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
        <nav className="ml-auto flex items-center gap-2">
          <TranslateButton
            onSelect={triggerTranslate}
            translating={translating}
            translated={translated}
            onReset={triggerReset}
          />
          {aiStatus === 'running' && (
            <span className="hidden sm:flex items-center gap-1.5 text-xs text-amber-400 animate-pulse">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0" />
              {aiTitle ? `AI: 「${aiTitle}」` : 'AI分析中...'}
            </span>
          )}
          {aiStatus === 'done' && (
            <span className="hidden sm:inline text-xs text-emerald-400">✓ AI分類完了</span>
          )}
          {isEditor && (
            <>
              <button
                onClick={() => setShowExtract(true)}
                className="text-xs px-2.5 py-1 rounded-full bg-amber-500 hover:bg-amber-400 text-black font-semibold transition-colors whitespace-nowrap"
              >
                Web記事抽出
              </button>
              <Link
                to="/write"
                className="text-xs px-2.5 py-1 rounded-full bg-amber-500 hover:bg-amber-400 text-black font-semibold transition-colors whitespace-nowrap"
              >
                + 投稿 / Write
              </Link>
            </>
          )}
          {showExtract && <ExtractDialog onClose={() => setShowExtract(false)} />}
        </nav>
      </div>
    </header>
  );
}
