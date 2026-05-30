import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import MDEditor from '@uiw/react-md-editor';
import { api } from '../api/client';
import type { Category } from '../types';

export default function WritePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const editSlug = searchParams.get('edit');

  const [title, setTitle] = useState('');
  const [titleJa, setTitleJa] = useState('');
  const [body, setBody] = useState('');
  const [selectedCats, setSelectedCats] = useState<string[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [heroFile, setHeroFile] = useState<File | null>(null);
  const [heroPreview, setHeroPreview] = useState<string | null>(null);
  const [additionalFiles, setAdditionalFiles] = useState<File[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [submitting, setSubmitting] = useState(false);


  const heroDrop = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.categories.list().then(setCategories).catch(() => {});
    if (editSlug) {
      api.articles.get(editSlug).then((art) => {
        setTitle(art.title);
        setTitleJa(art.title_ja ?? '');
        setBody(art.body);
        setSelectedCats(art.categories);
        setTags(art.tags);
      }).catch(() => {});
    }
  }, [editSlug]);

  const handleHeroDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
      setHeroFile(file);
      setHeroPreview(URL.createObjectURL(file));
    }
  };

  const handleHeroInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setHeroFile(file);
      setHeroPreview(URL.createObjectURL(file));
    }
  };

  const addTag = () => {
    const t = tagInput.trim().toLowerCase();
    if (t && !tags.includes(t)) {
      setTags((prev) => [...prev, t]);
    }
    setTagInput('');
  };

  const toggleCat = (slug: string) => {
    setSelectedCats((prev) => prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug]);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      if (editSlug) {
        await api.articles.update(editSlug, {
          title, title_ja: titleJa, body,
          categories: selectedCats, tags,
        });
        navigate(`/articles/${editSlug}`);
        return;
      }

      const form = new FormData();
      form.append('title', title);
      if (titleJa) form.append('title_ja', titleJa);
      form.append('body', body);
      form.append('categories', JSON.stringify(selectedCats));
      form.append('tags', JSON.stringify(tags));
      form.append('auto_classify', selectedCats.length === 0 ? 'true' : 'false');
      if (heroFile) form.append('hero_image', heroFile);
      for (const f of additionalFiles) form.append('additional_images', f);

      const created = await api.articles.create(form);
      navigate(`/articles/${created.slug}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-10">
      <h2 className="text-2xl font-bold text-gray-900 mb-8">{editSlug ? '記事を編集' : '新しい記事を投稿'}</h2>
      <form onSubmit={handleSubmit} className="space-y-6">

        {/* Title */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">タイトル (Title) <span className="text-red-500">*</span></label>
            <input type="text" required value={title} onChange={(e) => setTitle(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
              placeholder="Article title"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">日本語タイトル</label>
            <input type="text" value={titleJa} onChange={(e) => setTitleJa(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
              placeholder="日本語のタイトル（任意）"
            />
          </div>
        </div>

        {/* Hero image */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">ヒーロー画像</label>
          <div
            ref={heroDrop}
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleHeroDrop}
            className="relative border-2 border-dashed border-gray-200 rounded-xl overflow-hidden cursor-pointer hover:border-indigo-300 transition-colors"
            style={{ minHeight: '160px' }}
            onClick={() => document.getElementById('hero-input')?.click()}
          >
            {heroPreview ? (
              <img src={heroPreview} alt="preview" className="w-full h-48 object-cover" />
            ) : (
              <div className="flex flex-col items-center justify-center h-40 text-gray-400">
                <svg className="w-10 h-10 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <p className="text-sm">ドラッグ＆ドロップ または クリックして選択</p>
              </div>
            )}
            <input id="hero-input" type="file" accept="image/*" onChange={handleHeroInput} className="hidden" />
          </div>
        </div>

        {/* Body */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">本文 (Markdown)</label>
          <div data-color-mode="light">
            <MDEditor value={body} onChange={(v) => setBody(v ?? '')} height={400} />
          </div>
        </div>

        {/* Additional images */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">追加画像</label>
          <input type="file" accept="image/*" multiple onChange={(e) => setAdditionalFiles(Array.from(e.target.files ?? []))}
            className="text-sm text-gray-600 file:mr-3 file:text-sm file:font-medium file:bg-indigo-50 file:text-indigo-700 file:border-0 file:px-3 file:py-1 file:rounded-lg hover:file:bg-indigo-100"
          />
          {additionalFiles.length > 0 && (
            <p className="text-xs text-gray-400 mt-1">{additionalFiles.length}件選択済み</p>
          )}
        </div>

        {/* Categories */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            カテゴリー <span className="text-xs text-gray-400 font-normal">(未選択の場合はAIが自動分類)</span>
          </label>
          <div className="flex flex-wrap gap-2">
            {categories.map((cat) => (
              <button
                key={cat.slug}
                type="button"
                onClick={() => toggleCat(cat.slug)}
                className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                  selectedCats.includes(cat.slug) ? 'text-white border-transparent' : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                }`}
                style={selectedCats.includes(cat.slug) ? { backgroundColor: cat.color, borderColor: cat.color } : {}}
              >
                {cat.name_ja} / {cat.name_en}
              </button>
            ))}
          </div>
        </div>

        {/* Tags */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">タグ</label>
          <div className="flex gap-2 mb-2">
            <input
              type="text"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }}
              placeholder="タグを入力 → Enter"
              className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
            />
            <button type="button" onClick={addTag} className="px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600 transition-colors">追加</button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {tags.map((tag) => (
              <span key={tag} className="inline-flex items-center gap-1 text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                #{tag}
                <button type="button" onClick={() => setTags((prev) => prev.filter((t) => t !== tag))} className="text-gray-400 hover:text-red-500">×</button>
              </span>
            ))}
          </div>
        </div>

        {/* Submit */}
        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            disabled={submitting}
            className="flex-1 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-medium py-3 rounded-xl transition-colors"
          >
            {submitting ? '投稿中...' : editSlug ? '更新する' : '投稿する'}
          </button>
          <button type="button" onClick={() => navigate(-1)} className="px-6 py-3 border border-gray-200 text-gray-600 rounded-xl hover:bg-gray-50 transition-colors">
            キャンセル
          </button>
        </div>
      </form>
    </div>
  );
}
