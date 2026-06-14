import { useEffect, useRef } from 'react';

interface Props {
  content: string;
  attribution?: string;
  onChange: (content: string, attribution?: string) => void;
  onFocus: () => void;
}

function AutoTextarea({
  value, onChange, onFocus, placeholder, className,
}: {
  value: string; onChange: (v: string) => void; onFocus: () => void;
  placeholder: string; className?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const resize = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
  };
  useEffect(resize, [value]);

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={e => { onChange(e.target.value); resize(); }}
      onFocus={onFocus}
      placeholder={placeholder}
      rows={1}
      className={`w-full bg-transparent text-slate-100 leading-relaxed resize-none outline-none placeholder-slate-600 ${className ?? ''}`}
    />
  );
}

export default function QuoteBlock({ content, attribution, onChange, onFocus }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  const handleFocus = () => {
    onFocus();
    setTimeout(() => {
      ref.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 300);
  };

  return (
    <div ref={ref} className="border-l-4 border-amber-500/60 pl-4 space-y-2">
      <AutoTextarea
        value={content}
        onChange={v => onChange(v, attribution)}
        onFocus={handleFocus}
        placeholder="引用文を入力..."
        className="italic text-slate-300"
      />
      <AutoTextarea
        value={attribution ?? ''}
        onChange={v => onChange(content, v || undefined)}
        onFocus={handleFocus}
        placeholder="出典（任意）..."
        className="text-sm text-slate-500"
      />
    </div>
  );
}
