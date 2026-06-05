import { createContext, useCallback, useContext, useRef, useState } from 'react';
import type { ReactNode } from 'react';

interface Handlers {
  onSelect: (language: string) => Promise<void>;
  onReset: () => void;
}

interface TranslationContextValue {
  translating: boolean;
  translated: boolean;
  triggerTranslate: (language: string) => void;
  triggerReset: () => void;
  registerHandlers: (h: Handlers | null) => void;
}

const TranslationContext = createContext<TranslationContextValue>({
  translating: false,
  translated: false,
  triggerTranslate: () => {},
  triggerReset: () => {},
  registerHandlers: () => {},
});

export function TranslationProvider({ children }: { children: ReactNode }) {
  const [translating, setTranslating] = useState(false);
  const [translated, setTranslated] = useState(false);
  const handlersRef = useRef<Handlers | null>(null);

  const registerHandlers = useCallback((h: Handlers | null) => {
    handlersRef.current = h;
    if (!h) setTranslated(false);
  }, []);

  const triggerTranslate = useCallback(async (language: string) => {
    if (!handlersRef.current) return;
    setTranslating(true);
    try {
      await handlersRef.current.onSelect(language);
      setTranslated(true);
    } finally {
      setTranslating(false);
    }
  }, []);

  const triggerReset = useCallback(() => {
    handlersRef.current?.onReset();
    setTranslated(false);
  }, []);

  return (
    <TranslationContext.Provider value={{ translating, translated, triggerTranslate, triggerReset, registerHandlers }}>
      {children}
    </TranslationContext.Provider>
  );
}

export function useTranslation() {
  return useContext(TranslationContext);
}
