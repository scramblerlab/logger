import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

interface SearchContextValue {
  /** Total server-side hit count for the active query, or null when not searching. */
  hitCount: number | null;
  setHitCount: (n: number | null) => void;
}

const SearchContext = createContext<SearchContextValue>({
  hitCount: null,
  setHitCount: () => {},
});

export function SearchProvider({ children }: { children: ReactNode }) {
  const [hitCount, setHitCountState] = useState<number | null>(null);
  // Stable identity so Home can call it from effects without re-running them.
  const setHitCount = useCallback((n: number | null) => setHitCountState(n), []);
  return (
    <SearchContext.Provider value={{ hitCount, setHitCount }}>
      {children}
    </SearchContext.Provider>
  );
}

export const useSearchResults = () => useContext(SearchContext);
