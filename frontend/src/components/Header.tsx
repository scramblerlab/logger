import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useAiJob } from '../context/AiJobContext';
import { useTranslation } from '../context/TranslationContext';
import TranslateButton from './TranslateButton';
import ExtractDialog from './ExtractDialog';
import logo from '../assets/logo.png';

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

  const searchInput = (
    <div className="relative">
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="記事を検索 / Search..."
        className="w-full pl-9 pr-4 py-2 text-sm bg-surface2 border border-rim text-slate-100 placeholder-slate-500 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent"
      />
      <svg className="absolute left-2.5 top-2.5 w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
    </div>
  );

  return (
    <header className="bg-surface border-b border-rim sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4">

        {/* ── Row 1: Logo + Search  +  (desktop) nav ── */}
        <div className="h-12 sm:h-16 flex items-center gap-4">
          <Link to="/" className="flex-shrink-0" aria-label="Generative Logger — home">
            <img src={logo} alt="Generative Logger" className="h-9 sm:h-12 w-auto" />
          </Link>

          {/* Search — visible on all breakpoints */}
          <form onSubmit={handleSearch} className="flex-1 sm:max-w-md">
            {searchInput}
          </form>

          {/* Desktop nav */}
          <nav className="hidden sm:flex ml-auto items-center gap-2">
            <TranslateButton
              onSelect={triggerTranslate}
              translating={translating}
              translated={translated}
              onReset={triggerReset}
            />
            {aiStatus === 'running' && (
              <span className="hidden lg:flex items-center gap-1.5 text-xs text-amber-400 animate-pulse">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0" />
                {aiTitle ? `AI: 「${aiTitle}」` : 'AI分析中...'}
              </span>
            )}
            {aiStatus === 'done' && (
              <span className="hidden lg:inline text-xs text-emerald-400">✓ AI分類完了</span>
            )}
            {isEditor && (
              <>
                <button onClick={() => setShowExtract(true)} className="btn btn-solid">
                  Web記事抽出
                </button>
                <Link to="/write" className="btn btn-solid">
                  + 投稿 / Write
                </Link>
              </>
            )}
          </nav>
        </div>

        {/* ── Row 2 (mobile only): action buttons ── */}
        <div className="sm:hidden flex items-center gap-2 pb-2">
          <TranslateButton
            onSelect={triggerTranslate}
            translating={translating}
            translated={translated}
            onReset={triggerReset}
          />
          {isEditor && (
            <>
              <button onClick={() => setShowExtract(true)} className="btn btn-solid">抽出</button>
              <Link to="/write" className="btn btn-solid">投稿</Link>
            </>
          )}
        </div>

      </div>

      {showExtract && <ExtractDialog onClose={() => setShowExtract(false)} />}
    </header>
  );
}
