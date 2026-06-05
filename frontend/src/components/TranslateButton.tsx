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
      <div className="flex items-center gap-1.5 text-xs text-black bg-amber-500 px-2.5 py-1 rounded-full font-display tracking-wide whitespace-nowrap">
        <div className="w-3 h-3 border-2 border-black border-t-transparent rounded-full animate-spin flex-shrink-0" />
        Translating...
      </div>
    );
  }

  return (
    <div ref={ref} className="relative flex items-center gap-1.5">
      {translated && (
        <button
          onClick={onReset}
          className="text-xs px-2.5 py-1 rounded-full bg-surface2 hover:bg-rim border border-rim text-slate-300 font-semibold transition-colors whitespace-nowrap"
        >
          ↩ Reset
        </button>
      )}
      <button
        onClick={() => setOpen((v) => !v)}
        className="text-xs px-2.5 py-1 rounded-full bg-amber-500 hover:bg-amber-400 text-black font-display tracking-wide transition-colors whitespace-nowrap"
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
