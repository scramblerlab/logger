import { useRef } from 'react';

interface Props {
  content: string;
  level: 2 | 3 | 4;
  onChange: (content: string) => void;
  onFocus: () => void;
}

const sizeClass: Record<2 | 3 | 4, string> = {
  2: 'text-2xl font-bold',
  3: 'text-xl font-semibold',
  4: 'text-lg font-semibold',
};

export default function HeadingBlock({ content, level, onChange, onFocus }: Props) {
  const ref = useRef<HTMLInputElement>(null);

  const handleFocus = () => {
    onFocus();
    setTimeout(() => {
      ref.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 300);
  };

  return (
    <input
      ref={ref}
      type="text"
      value={content}
      onChange={e => onChange(e.target.value)}
      onFocus={handleFocus}
      placeholder={`H${level} 見出し...`}
      className={`w-full bg-transparent text-slate-100 outline-none placeholder-slate-600 py-1 ${sizeClass[level]}`}
    />
  );
}
