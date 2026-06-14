import React, { useEffect, useRef } from 'react';

interface Props {
  content: string;
  onChange: (content: string) => void;
  onFocus: () => void;
  placeholder?: string;
}

export default React.memo(function ParagraphBlock({ content, onChange, onFocus, placeholder = '本文を入力...' }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const resize = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
  };

  useEffect(resize, [content]);

  const handleFocus = () => {
    onFocus();
    setTimeout(() => {
      ref.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 300);
  };

  return (
    <textarea
      ref={ref}
      value={content}
      onChange={e => { onChange(e.target.value); resize(); }}
      onFocus={handleFocus}
      placeholder={placeholder}
      rows={1}
      className="w-full bg-transparent text-slate-100 text-base leading-relaxed resize-none outline-none placeholder-slate-600 py-1"
    />
  );
});
