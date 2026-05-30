interface Props {
  slug: string;
  nameEn: string;
  nameJa: string;
  color: string;
  onClick?: () => void;
}

export default function CategoryBadge({ nameEn, nameJa, color, onClick }: Props) {
  return (
    <span
      onClick={onClick}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium text-white cursor-pointer select-none`}
      style={{ backgroundColor: color }}
    >
      {nameJa} / {nameEn}
    </span>
  );
}
