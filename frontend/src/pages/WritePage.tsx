import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import MDEditor from '@uiw/react-md-editor';
import { api, heroImageUrl } from '../api/client';
import type { Category } from '../types';

const inputCls = 'w-full bg-gray-800 border border-gray-600 text-gray-100 placeholder-gray-500 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent';

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
  const [existingAdditional, setExistingAdditional] = useState<string[]>([]);
  const [removedImages, setRemovedImages] = useState<string[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [classifying, setClassifying] = useState(false);
  const [classifyMsg, setClassifyMsg] = useState('');

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
        const url = heroImageUrl(art.slug, art.hero_image);
        if (url) setHeroPreview(url);
      }).catch(() => {});
      fetch(`/static/articles/${editSlug}/article.json`)
        .then((r) => r.ok ? r.json() : null)
        .then((data) => { if (data?.additionalImages) setExistingAdditional(data.additionalImages); })
        .catch(() => {});
    }
  }, [editSlug]);

  const handleHeroDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file?.type.startsWith('image/')) { setHeroFile(file); setHeroPreview(URL.createObjectURL(file)); }
  };
  const handleHeroInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) { setHeroFile(file); setHeroPreview(URL.createObjectURL(file)); }
  };

  const addTag = () => {
    const t = tagInput.trim().toLowerCase();
    if (t && !tags.includes(t)) setTags((p) => [...p, t]);
    setTagInput('');
  };
  const toggleCat = (slug: string) =>
    setSelectedCats((p) => p.includes(slug) ? p.filter((s) => s !== slug) : [...p, slug]);

  const handleAiClassify = async () => {
    if (!title) return;
    setClassifying(true); setClassifyMsg('');
    try {
      const result = await api.articles.aiClassify(title, body);
      if (result.categories.length > 0) {
        setSelectedCats(result.categories);
        if (result.tags.length > 0) setTags(result.tags);
        setClassifyMsg(`AI分類: ${result.categories.join(', ')}`);
      } else {
        setClassifyMsg('カテゴリーを判定できませんでした');
      }
    } catch { setClassifyMsg('エラーが発生しました'); }
    finally { setClassifying(false); }
  };

  const removeExistingImage = (rel: string) => {
    setRemovedImages((p) => [...p, rel]);
    setExistingAdditional((p) => p.filter((x) => x !== rel));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const form = new FormData();
      form.append('title', title);
      form.append('title_ja', titleJa);
      form.append('body', body);
      form.append('categories', JSON.stringify(selectedCats));
      form.append('tags', JSON.stringify(tags));

      if (editSlug) {
        form.append('remove_image_paths', JSON.stringify(removedImages));
        if (heroFile) form.append('hero_image', heroFile);
        for (const f of additionalFiles) form.append('additional_images', f);
        await api.articles.update(editSlug, form);
        navigate(`/articles/${editSlug}`);
      } else {
        form.append('auto_classify', selectedCats.length === 0 ? 'true' : 'false');
        if (heroFile) form.append('hero_image', heroFile);
        for (const f of additionalFiles) form.append('additional_images', f);
        const created = await api.articles.create(form);
        navigate(`/articles/${created.slug}`);
      }
    } finally { setSubmitting(false); }
  };

  const labelCls = 'block text-sm font-medium text-gray-400 mb-1';

  return (
    <div className="max-w-3xl mx-auto px-4 py-10">
      <h2 className="text-2xl font-bold text-gray-100 mb-8">{editSlug ? '記事を編集' : '新しい記事を投稿'}</h2>
      <form onSubmit={handleSubmit} className="space-y-6">

        {/* Title */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>タイトル (Title) <span className="text-red-400">*</span></label>
            <input type="text" required value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} placeholder="Article title" />
          </div>
          <div>
            <label className={labelCls}>日本語タイトル</label>
            <input type="text" value={titleJa} onChange={(e) => setTitleJa(e.target.value)} className={inputCls} placeholder="日本語のタイトル（任意）" />
          </div>
        </div>

        {/* Hero image */}
        <div>
          <label className={labelCls}>
            ヒーロー画像
            {editSlug && heroPreview && !heroFile && <span className="text-xs text-gray-600 font-normal ml-2">現在の画像 (クリックで変更)</span>}
          </label>
          <div
            ref={heroDrop}
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleHeroDrop}
            className="relative border-2 border-dashed border-gray-600 rounded-xl overflow-hidden cursor-pointer hover:border-indigo-500 transition-colors"
            style={{ minHeight: '160px' }}
            onClick={() => document.getElementById('hero-input')?.click()}
          >
            {heroPreview ? (
              <div className="relative">
                <img src={heroPreview} alt="preview" className="w-full h-48 object-cover" />
                {heroFile && <span className="absolute top-2 right-2 bg-indigo-500 text-white text-xs px-2 py-0.5 rounded-lg">新しい画像</span>}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-40 text-gray-600">
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
          <label className={labelCls}>本文 (Markdown)</label>
          <div data-color-mode="dark">
            <MDEditor value={body} onChange={(v) => setBody(v ?? '')} height={400} />
          </div>
        </div>

        {/* Existing additional images (edit mode) */}
        {editSlug && existingAdditional.length > 0 && (
          <div>
            <label className={labelCls}>現在の追加画像</label>
            <div className="flex flex-wrap gap-3">
              {existingAdditional.map((rel) => (
                <div key={rel} className="relative group w-24 h-24">
                  <img src={`/static/articles/${editSlug}/${rel}`} alt="" className="w-24 h-24 object-cover rounded-lg ring-1 ring-gray-600" />
                  <button type="button" onClick={() => removeExistingImage(rel)}
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-600 text-white rounded-full text-xs leading-none opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                  >×</button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Additional images upload */}
        <div>
          <label className={labelCls}>{editSlug ? '追加画像を追加' : '追加画像'}</label>
          <input type="file" accept="image/*" multiple
            onChange={(e) => setAdditionalFiles(Array.from(e.target.files ?? []))}
            className="text-sm text-gray-400 file:mr-3 file:text-sm file:font-medium file:bg-indigo-500 file:text-white file:border-0 file:px-3 file:py-1 file:rounded-lg hover:file:bg-indigo-400 file:transition-colors"
          />
          {additionalFiles.length > 0 && <p className="text-xs text-gray-500 mt-1">{additionalFiles.length}件選択済み</p>}
        </div>

        {/* Categories */}
        <div>
          <div className="flex items-center gap-3 mb-2">
            <label className="text-sm font-medium text-gray-400">カテゴリー</label>
            <button type="button" onClick={handleAiClassify} disabled={classifying || !title}
              className="text-xs px-3 py-1 rounded-lg bg-indigo-500 hover:bg-indigo-400 text-white font-medium disabled:opacity-40 transition-colors"
            >
              {classifying ? '⏳ AI分析中...' : '✦ AI分析'}
            </button>
            {classifyMsg && (
              <span className={`text-xs ${classifyMsg.includes('エラー') || classifyMsg.includes('できません') ? 'text-red-400' : 'text-indigo-400'}`}>
                {classifyMsg}
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {categories.map((cat) => (
              <button key={cat.slug} type="button" onClick={() => toggleCat(cat.slug)}
                className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                  selectedCats.includes(cat.slug)
                    ? 'text-white border-transparent'
                    : 'border-gray-600 text-gray-400 hover:bg-gray-700 hover:text-gray-200'
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
          <label className={labelCls}>タグ</label>
          <div className="flex gap-2 mb-2">
            <input type="text" value={tagInput} onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }}
              placeholder="タグを入力 → Enter" className={inputCls}
            />
            <button type="button" onClick={addTag}
              className="px-4 py-2 text-sm bg-gray-700 hover:bg-gray-600 text-gray-300 font-medium rounded-lg border border-gray-600 transition-colors"
            >追加</button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {tags.map((tag) => (
              <span key={tag} className="inline-flex items-center gap-1 text-xs bg-gray-700 text-gray-300 px-2 py-0.5 rounded-full">
                #{tag}
                <button type="button" onClick={() => setTags((p) => p.filter((t) => t !== tag))} className="text-gray-500 hover:text-red-400 transition-colors">×</button>
              </span>
            ))}
          </div>
        </div>

        {/* Submit */}
        <div className="flex gap-3 pt-2">
          <button type="submit" disabled={submitting}
            className="flex-1 bg-indigo-500 hover:bg-indigo-400 disabled:opacity-50 text-white font-medium py-3 rounded-xl transition-colors"
          >
            {submitting ? '投稿中...' : editSlug ? '更新する' : '投稿する'}
          </button>
          <button type="button" onClick={() => navigate(-1)}
            className="px-6 py-3 bg-gray-700 hover:bg-gray-600 text-gray-300 font-medium rounded-xl border border-gray-600 transition-colors"
          >
            キャンセル
          </button>
        </div>
      </form>
    </div>
  );
}
