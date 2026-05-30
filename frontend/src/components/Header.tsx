import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

interface Props {
  onSearch: (q: string) => void;
}

export default function Header({ onSearch }: Props) {
  const [query, setQuery] = useState('');
  const navigate = useNavigate();

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      navigate(`/?q=${encodeURIComponent(query.trim())}`);
      onSearch(query.trim());
    }
  };

  return (
    <header className="bg-gray-900 border-b border-gray-700 sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4 h-16 flex items-center gap-4">
        <Link to="/" className="font-bold text-xl text-indigo-400 flex-shrink-0">
          logger
        </Link>
        <form onSubmit={handleSearch} className="flex-1 max-w-md">
          <div className="relative">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="記事を検索 / Search articles..."
              className="w-full pl-9 pr-4 py-2 text-sm bg-gray-800 border border-gray-600 text-gray-100 placeholder-gray-500 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
            <svg className="absolute left-2.5 top-2.5 w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
        </form>
        <nav className="ml-auto">
          <Link
            to="/write"
            className="inline-flex items-center gap-1.5 bg-indigo-500 hover:bg-indigo-400 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            投稿 / Write
          </Link>
        </nav>
      </div>
    </header>
  );
}
