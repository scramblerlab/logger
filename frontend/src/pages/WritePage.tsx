import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import MDEditor from '@uiw/react-md-editor';
import { api, heroImageUrl } from '../api/client';
import type { Category } from '../types';
import { useAuth } from '../context/AuthContext';

const inputCls = 'w-full bg-surface2 border border-rim2 text-slate-100 placeholder-slate-500 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent';

export default function WritePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const editSlug = searchParams.get('edit');
  const { isEditor, isLoading } = useAuth();

  useEffect(() => {
    if (!isLoading && !isEditor) navigate('/');
  }, [isLoading, isEditor, navigate]);

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [selectedCats, setSelectedCats] = useState<string[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [heroFile, setHeroFile] = useState<File | null>(null);
  const [heroPreview, setHeroPreview] = useState<string | null>(null);
  const [heroFromExisting, setHeroFromExisting] = useState<string | null>(null);
  const [additionalFiles, setAdditionalFiles] = useState<File[]>([]);
  const [existingAdditional, setExistingAdditional] = useState<string[]>([]);
  const [removedImages, setRemovedImages] = useState<string[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [publishedAt, setPublishedAt] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [classifying, setClassifying] = useState(false);
  const [classifyMsg, setClassifyMsg] = useState('');
  const [commenting, setCommenting] = useState(false);
  const [commentMsg, setCommentMsg] = useState('');
  const [currentComment, setCurrentComment] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  const heroDrop = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.categories.list().then(setCategories).catch(() => {});
    if (editSlug) {
      api.articles.get(editSlug).then((art) => {
        setTitle(art.title);
        setBody(art.body);
        setSelectedCats(art.categories);
        setTags(art.tags);
        if (art.published_at) {
          // datetime-local input expects "YYYY-MM-DDTHH:MM"
          setPublishedAt(art.published_at.slice(0, 16));
        }
        const url = heroImageUrl(art.slug, art.hero_image, art.updated_at);
        if (url) setHeroPreview(url);
        if (art.ai_comment) setCurrentComment(art.ai_comment);
      }).catch(() => {});
      fetch(`/static/articles/${editSlug}/article.json`)
        .then((r) => r.ok ? r.json() : null)
        .then((data) => { if (data?.additionalImages) setExistingAdditional(data.additionalImages); })
        .catch(() => {});
    }
  }, [editSlug]);

  // Initialize from web extraction state (new article only)
  useEffect(() => {
    if (editSlug) return;
    const extraction = (location.state as { extraction?: { title: string; body: string; hero_url: string | null; additional_urls: string[]; published_at: string | null; source_url: string } } | null)?.extraction;
    if (!extraction) return;
    setTitle(extraction.title);
    setBody(extraction.body);
    setSourceUrl(extraction.source_url ?? '');
    if (extraction.published_at) setPublishedAt(extraction.published_at.slice(0, 16));
    if (extraction.hero_url) {
      fetch(extraction.hero_url)
        .then((r) => r.blob())
        .then((blob) => {
          setHeroFile(new File([blob], 'hero.jpg', { type: 'image/jpeg' }));
          setHeroPreview(URL.createObjectURL(blob));
        })
        .catch(() => {});
    }
    for (const url of extraction.additional_urls ?? []) {
      fetch(url)
        .then((r) => r.blob())
        .then((blob) => {
          const fname = url.split('/').pop() || 'image.jpg';
          setAdditionalFiles((prev) => [...prev, new File([blob], fname, { type: 'image/jpeg' })]);
        })
        .catch(() => {});
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleHeroDrop = (e: React.DragEvent) => {
    e.preventDefault();
    // File from OS / file system drag
    const file = e.dataTransfer.files[0];
    if (file?.type.startsWith('image/')) {
      setHeroFile(file);
      setHeroFromExisting(null);
      setHeroPreview(URL.createObjectURL(file));
      return;
    }
    // Drag from existing additional image thumbnails (rel path set in onDragStart)
    const relPath = e.dataTransfer.getData('text/plain');
    if (relPath && editSlug) {
      setHeroFromExisting(relPath);
      setHeroFile(null);
      setHeroPreview(`/static/articles/${editSlug}/${relPath}`);
    }
  };
  const handleHeroInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) { setHeroFile(file); setHeroFromExisting(null); setHeroPreview(URL.createObjectURL(file)); }
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

  const handleAiComment = async () => {
    if (!editSlug) return;
    setCommenting(true); setCommentMsg('');
    try {
      const result = await api.articles.aiComment(editSlug);
      setCurrentComment(result.ai_comment);
      setCommentMsg(`生成完了 (${result.ai_comment_model})`);
    } catch { setCommentMsg('エラーが発生しました'); }
    finally { setCommenting(false); }
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
      form.append('body', body);
      form.append('categories', JSON.stringify(selectedCats));
      form.append('tags', JSON.stringify(tags));

      if (editSlug) {
        if (publishedAt) form.append('published_at', publishedAt);
        form.append('remove_image_paths', JSON.stringify(removedImages));
        if (heroFile) form.append('hero_image', heroFile);
        else if (heroFromExisting) form.append('reuse_image_as_hero', heroFromExisting);
        for (const f of additionalFiles) form.append('additional_images', f);
        await api.articles.update(editSlug, form);
        navigate(`/articles/${editSlug}`);
      } else {
        form.append('auto_classify', selectedCats.length === 0 ? 'true' : 'false');
        if (sourceUrl) form.append('source_url', sourceUrl);
        if (heroFile) form.append('hero_image', heroFile);
        for (const f of additionalFiles) form.append('additional_images', f);
        const created = await api.articles.create(form);
        navigate(`/articles/${created.slug}`);
      }
    } finally { setSubmitting(false); }
  };

  const labelCls = 'block text-sm font-medium text-slate-400 mb-1';

  return (
    <div className="max-w-3xl mx-auto px-4 py-10">
      <h2 className="font-display text-4xl tracking-wide text-slate-100 mb-8">{editSlug ? '記事を編集' : '新しい記事を投稿'}</h2>
      <form onSubmit={handleSubmit} className="space-y-6">

        {/* Title */}
        <div>
          <label className={labelCls}>タイトル (Title) <span className="text-red-400">*</span></label>
          <input type="text" required value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} placeholder="Article title" />
        </div>

        {/* Published date (edit only) */}
        {editSlug && (
          <div className="max-w-xs">
            <label className={labelCls}>公開日時</label>
            <input
              type="datetime-local"
              value={publishedAt}
              onChange={(e) => setPublishedAt(e.target.value)}
              className={inputCls}
            />
          </div>
        )}

        {/* Hero image */}
        <div>
          <label className={labelCls}>
            ヒーロー画像
            {editSlug && heroPreview && !heroFile && <span className="text-xs text-slate-600 font-normal ml-2">現在の画像 (クリックで変更)</span>}
          </label>
          <div
            ref={heroDrop}
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleHeroDrop}
            className="relative border-2 border-dashed border-rim2 rounded-xl overflow-hidden cursor-pointer hover:border-amber-500 transition-colors"
            style={{ minHeight: '160px' }}
            onClick={() => document.getElementById('hero-input')?.click()}
          >
            {heroPreview ? (
              <div className="relative">
                <img src={heroPreview} alt="preview" className="w-full h-48 object-cover" />
                {heroFile && <span className="absolute top-2 right-2 bg-amber-500 text-black text-xs font-semibold px-2 py-0.5 rounded-lg">新しい画像</span>}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-40 text-slate-500">
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
            <MDEditor value={body} onChange={(v) => setBody(v ?? '')} height={400} preview={isMobile ? 'edit' : 'live'} />
          </div>
        </div>

        {/* Existing additional images (edit mode) */}
        {editSlug && existingAdditional.length > 0 && (
          <div>
            <label className={labelCls}>現在の追加画像 <span className="text-xs text-slate-600 font-normal">（ヒーロー画像エリアにドラッグしてセット可）</span></label>
            <div className="flex flex-wrap gap-3">
              {existingAdditional.map((rel) => (
                <div
                  key={rel}
                  className="relative group w-24 h-24 cursor-grab active:cursor-grabbing"
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('text/plain', rel);
                    e.dataTransfer.effectAllowed = 'copy';
                  }}
                >
                  <img src={`/static/articles/${editSlug}/${rel}`} alt="" className="w-24 h-24 object-cover rounded-lg ring-1 ring-rim select-none" />
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
            className="text-xs text-slate-400 file:mr-3 file:text-xs file:font-semibold file:bg-amber-500 file:text-black file:border-0 file:px-2.5 file:py-1 file:rounded-full hover:file:bg-amber-400 file:transition-colors"
          />
          {additionalFiles.length > 0 && <p className="text-xs text-slate-500 mt-1">{additionalFiles.length}件選択済み</p>}
        </div>

        {/* Categories */}
        <div>
          <div className="flex items-center gap-3 mb-2">
            <label className="text-sm font-medium text-slate-400">カテゴリー</label>
            <button type="button" onClick={handleAiClassify} disabled={classifying || !title}
              className="btn btn-solid disabled:opacity-40"
            >
              {classifying ? '⏳ AI分析中...' : '✦ AI分析'}
            </button>
            {classifyMsg && (
              <span className={`text-xs ${classifyMsg.includes('エラー') || classifyMsg.includes('できません') ? 'text-red-400' : 'text-amber-400'}`}>
                {classifyMsg}
              </span>
            )}
          </div>
          {editSlug && (
            <div className="mb-2 space-y-2">
              <div className="flex items-center gap-3">
                <button type="button" onClick={handleAiComment} disabled={commenting}
                  className="btn btn-solid disabled:opacity-40"
                >
                  {commenting ? '⏳ 生成中...' : '✦ AIコメント追加/変更'}
                </button>
                {commentMsg && (
                  <span className={`text-xs ${commentMsg.includes('エラー') ? 'text-red-400' : 'text-amber-400'}`}>
                    {commentMsg}
                  </span>
                )}
              </div>
              {currentComment && (
                <div className="p-3 rounded-lg border border-amber-500/30 bg-amber-500/5">
                  <p className="text-xs font-semibold text-amber-400 mb-1">✦ AIコメント（現在）</p>
                  <p className="text-xs text-slate-300 leading-relaxed whitespace-pre-wrap">{currentComment}</p>
                </div>
              )}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {categories.map((cat) => (
              <button key={cat.slug} type="button" onClick={() => toggleCat(cat.slug)}
                className={`btn ${
                  selectedCats.includes(cat.slug)
                    ? 'text-white border-transparent border'
                    : 'btn-outline'
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
            <button type="button" onClick={addTag} className="btn btn-outline">追加</button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {tags.map((tag) => (
              <span key={tag} className="inline-flex items-center gap-1 text-xs bg-surface2 text-slate-300 px-2 py-0.5 rounded-full">
                #{tag}
                <button type="button" onClick={() => setTags((p) => p.filter((t) => t !== tag))} className="text-slate-500 hover:text-red-400 transition-colors">×</button>
              </span>
            ))}
          </div>
        </div>

        {/* Submit */}
        <div className="flex gap-3 pt-2">
          <button type="submit" disabled={submitting}
            className="flex-1 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black font-bold text-sm py-2 rounded-full transition-colors"
          >
            {submitting ? '投稿中...' : editSlug ? '更新する' : '投稿する'}
          </button>
          <button type="button" onClick={() => navigate(-1)}
            className="text-xs px-4 py-2 rounded-full btn-outline font-semibold whitespace-nowrap"
          >
            キャンセル
          </button>
        </div>
      </form>
    </div>
  );
}
