import React, { useRef } from 'react';

interface Props {
  code: string;
  language?: string;
  onChange: (code: string, language?: string) => void;
  onFocus: () => void;
}

export default React.memo(function CodeBlock({ code, language, onChange, onFocus }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const handleFocus = () => {
    onFocus();
    setTimeout(() => {
      ref.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 300);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const el = e.currentTarget;
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const next = code.slice(0, start) + '  ' + code.slice(end);
      onChange(next, language);
      setTimeout(() => { el.selectionStart = el.selectionEnd = start + 2; }, 0);
    }
  };

  return (
    <div className="rounded-lg bg-canvas border border-rim2 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-rim2 bg-surface">
        <span className="text-xs text-slate-500 font-mono">lang:</span>
        <input
          type="text"
          value={language ?? ''}
          onChange={e => onChange(code, e.target.value || undefined)}
          placeholder="javascript"
          className="bg-transparent text-xs text-slate-400 font-mono outline-none placeholder-slate-700 flex-1"
        />
      </div>
      <textarea
        ref={ref}
        value={code}
        onChange={e => onChange(e.target.value, language)}
        onFocus={handleFocus}
        onKeyDown={handleKeyDown}
        placeholder="コードを入力..."
        rows={4}
        spellCheck={false}
        className="w-full bg-transparent text-sm text-green-300 font-mono leading-relaxed resize-none outline-none placeholder-slate-700 p-3"
      />
    </div>
  );
});
