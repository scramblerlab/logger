import { useEffect, useRef, useState } from 'react';

const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'fr', label: 'Français' },
  { code: 'es', label: 'Español' },
  { code: 'it', label: 'Italiano' },
  { code: 'de', label: 'Deutsch' },
  { code: 'el', label: 'Ελληνικά' },
  { code: 'zh', label: '中文' },
  { code: 'ko', label: '한국어' },
];

interface Props {
  onSelect: (languageName: string) => void;
  translating: boolean;
  translated: boolean;
  onReset: () => void;
}

export default function TranslateButton({ onSelect, translating, translated, onReset }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  if (translating) {
    return (
      <div className="btn btn-solid flex items-center gap-1.5 font-display tracking-wide">
        <div className="w-3 h-3 border-2 border-black border-t-transparent rounded-full animate-spin flex-shrink-0" />
        Translating...
      </div>
    );
  }

  return (
    <div ref={ref} className="relative flex items-center gap-1.5">
      {translated && (
        <button onClick={onReset} className="btn btn-outline">↩ Reset</button>
      )}
      <button
        onClick={() => setOpen((v) => !v)}
        className="btn btn-solid font-display tracking-wide"
      >
        🌐 Translate
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 bg-surface border border-rim rounded-xl shadow-xl overflow-hidden min-w-[130px]">
          {LANGUAGES.map((lang) => (
            <button
              key={lang.code}
              onClick={() => { onSelect(lang.label); setOpen(false); }}
              className="w-full text-left px-4 py-2 text-sm text-slate-300 hover:bg-surface2 hover:text-white transition-colors"
            >
              {lang.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
