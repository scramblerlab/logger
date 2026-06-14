import { useRef } from 'react';

interface Props {
  items: string[];
  ordered: boolean;
  onChange: (items: string[]) => void;
  onToggleOrdered: (ordered: boolean) => void;
  onFocus: () => void;
}

export default function ListBlock({ items, ordered, onChange, onFocus }: Props) {
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const handleFocus = (i: number) => {
    onFocus();
    setTimeout(() => {
      inputRefs.current[i]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 300);
  };

  const update = (i: number, value: string) => {
    const next = [...items];
    next[i] = value;
    onChange(next);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, i: number) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const next = [...items.slice(0, i + 1), '', ...items.slice(i + 1)];
      onChange(next);
      setTimeout(() => inputRefs.current[i + 1]?.focus(), 0);
    } else if (e.key === 'Backspace' && items[i] === '' && items.length > 1) {
      e.preventDefault();
      const next = items.filter((_, idx) => idx !== i);
      onChange(next);
      setTimeout(() => inputRefs.current[Math.max(0, i - 1)]?.focus(), 0);
    }
  };

  return (
    <div className="space-y-1">
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="text-slate-500 text-sm w-5 shrink-0 text-right select-none">
            {ordered ? `${i + 1}.` : '•'}
          </span>
          <input
            ref={el => { inputRefs.current[i] = el; }}
            type="text"
            value={item}
            onChange={e => update(i, e.target.value)}
            onKeyDown={e => handleKeyDown(e, i)}
            onFocus={() => handleFocus(i)}
            placeholder="リスト項目..."
            className="flex-1 bg-transparent text-slate-100 text-base outline-none placeholder-slate-600 py-0.5"
          />
        </div>
      ))}
    </div>
  );
}
