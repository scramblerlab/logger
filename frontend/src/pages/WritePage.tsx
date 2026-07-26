import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { api, heroImageUrl } from '../api/client';
import type { Category } from '../types';
import { useAuth } from '../context/AuthContext';
import type { Block } from '../utils/blocks';
import { parseMarkdown, serializeBlocks, createBlock } from '../utils/blocks';
import BlockEditor from '../components/BlockEditor';
import PostResultBanner from '../components/PostResultBanner';

const inputCls = 'w-full bg-surface2 border border-rim2 text-slate-100 placeholder-slate-500 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent';

async function rotateFile(file: File, degrees: 0 | 90 | 180 | 270): Promise<File> {
  if (degrees === 0) return file;
  const img = await createImageBitmap(file);
  const swap = degrees === 90 || degrees === 270;
  const canvas = document.createElement('canvas');
  canvas.width = swap ? img.height : img.width;
  canvas.height = swap ? img.width : img.height;
  const ctx = canvas.getContext('2d')!;
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((degrees * Math.PI) / 180);
  ctx.drawImage(img, -img.width / 2, -img.height / 2);
  // Always output JPEG — canvas.toBlob silently produces null for HEIC/HEIF input
  return new Promise(resolve =>
    canvas.toBlob(
      blob => resolve(new File([blob!], file.name.replace(/\.\w+$/i, '.jpg'), { type: 'image/jpeg' })),
      'image/jpeg', 0.92,
    )
  );
}

// Fetch an image block's src, canvas-rotate it, and re-upload; returns updated block.
async function bakeBlockRotation(block: import('../utils/blocks').Block & { type: 'image' }, slug: string): Promise<import('../utils/blocks').Block> {
  if (!block.rotation || !block.src) return block;
  const fetchUrl = block.src.startsWith('http') || block.src.startsWith('/')
    ? block.src
    : `/static/articles/${slug}/${block.src}`;
  try {
    const blob = await (await fetch(fetchUrl)).blob();
    const rotated = await rotateFile(new File([blob], 'image.jpg', { type: 'image/jpeg' }), block.rotation);
    const relPath = await uploadImageToSlug(slug, rotated);
    if (relPath) return { ...block, src: relPath, rotation: undefined };
  } catch { /* ignore — keep original with CSS rotation as fallback */ }
  return block;
}

async function pollJob<T>(
  poll: () => Promise<{ status: string; result: T | null; error: string | null }>,
  intervalMs = 2000,
  timeoutMs = 180000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const s = await poll();
    if (s.status === 'done' && s.result !== null) return s.result;
    if (s.status === 'error') throw new Error(s.error ?? 'AI処理に失敗しました');
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error('タイムアウトしました');
}

async function uploadImageToSlug(slug: string, file: File): Promise<string | null> {
  const form = new FormData();
  form.append('image', file);
  try {
    const res = await fetch(`/api/articles/${slug}/images`, {
      method: 'POST', body: form, credentials: 'include',
    });
    if (!res.ok) return null;
    return (await res.json()).rel_path as string;
  } catch { return null; }
}

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
  const [blocks, setBlocks] = useState<Block[]>([createBlock('paragraph')]);
  const [selectedCats, setSelectedCats] = useState<string[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [heroFile, setHeroFile] = useState<File | null>(null);
  const [heroPreview, setHeroPreview] = useState<string | null>(null);
  const [heroFromExisting, setHeroFromExisting] = useState<string | null>(null);
  const [heroRotation, setHeroRotation] = useState<0 | 90 | 180 | 270>(0);
  const [categories, setCategories] = useState<Category[]>([]);
  const [publishedAt, setPublishedAt] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitStatus, setSubmitStatus] = useState<string | null>(null);
  const [classifying, setClassifying] = useState(false);
  const [classifyMsg, setClassifyMsg] = useState('');
  const [commenting, setCommenting] = useState(false);
  const [commentMsg, setCommentMsg] = useState('');
  const [currentComment, setCurrentComment] = useState<string | null>(null);
  const [postResult, setPostResult] = useState<
    { slug: string; bodySizeBytes: number; blockCount: number; publishedAt?: string } | null
  >(null);
  const [postError, setPostError] = useState<string | null>(null);

  const heroDrop = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.categories.list().then(setCategories).catch(() => {});
    if (editSlug) {
      api.articles.get(editSlug).then((art) => {
        setTitle(art.title);
        setBlocks(parseMarkdown(art.body));
        setSelectedCats(art.categories);
        setTags(art.tags);
        if (art.published_at) setPublishedAt(art.published_at.slice(0, 16));
        const url = heroImageUrl(art.slug, art.hero_image, art.updated_at);
        if (url) setHeroPreview(url);
        if (art.ai_comment) setCurrentComment(art.ai_comment);
      }).catch(() => {});
    }
  }, [editSlug]);

  // Initialize from web extraction state (new article only)
  useEffect(() => {
    if (editSlug) return;
    const extraction = (location.state as {
      extraction?: {
        title: string; body: string; hero_url: string | null;
        additional_urls: string[]; published_at: string | null; source_url: string;
      }
    } | null)?.extraction;
    if (!extraction) return;
    setTitle(extraction.title);
    setBlocks(parseMarkdown(extraction.body));
    setSourceUrl(extraction.source_url ?? '');
    if (extraction.published_at) setPublishedAt(extraction.published_at.slice(0, 16));
    if (extraction.hero_url) {
      fetch(extraction.hero_url)
        .then(r => r.blob())
        .then(blob => {
          setHeroFile(new File([blob], 'hero.jpg', { type: 'image/jpeg' }));
          setHeroPreview(URL.createObjectURL(blob));
        })
        .catch(() => {});
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleHeroDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file?.type.startsWith('image/')) {
      setHeroFile(file);
      setHeroFromExisting(null);
      setHeroPreview(URL.createObjectURL(file));
    }
  };
  const handleHeroInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) { setHeroFile(file); setHeroFromExisting(null); setHeroPreview(URL.createObjectURL(file)); setHeroRotation(0); }
  };

  const handleHeroRotate = () => {
    setHeroRotation(r => ((r + 90) % 360) as 0 | 90 | 180 | 270);
    // If rotating a server-loaded hero (no local File yet), fetch it so rotateFile can process it on submit
    if (!heroFile && heroPreview) {
      fetch(heroPreview)
        .then(r => r.blob())
        .then(blob => setHeroFile(new File([blob], 'hero.jpg', { type: 'image/jpeg' })))
        .catch(() => {});
    }
  };

  const addTag = () => {
    const t = tagInput.trim().toLowerCase();
    if (t && !tags.includes(t)) setTags(p => [...p, t]);
    setTagInput('');
  };
  const toggleCat = (slug: string) =>
    setSelectedCats(p => p.includes(slug) ? p.filter(s => s !== slug) : [...p, slug]);

  const handleAiClassify = async () => {
    if (!title) return;
    setClassifying(true); setClassifyMsg('');
    try {
      const { job_id } = await api.articles.aiClassify(title, serializeBlocks(blocks));
      const result = await pollJob(() => api.articles.aiClassifyStatus(job_id));
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
      await api.articles.aiComment(editSlug);
      const result = await pollJob(() => api.articles.aiCommentStatus(editSlug));
      setCurrentComment(result.ai_comment);
      setCommentMsg(`生成完了 (${result.ai_comment_model})`);
    } catch { setCommentMsg('エラーが発生しました'); }
    finally { setCommenting(false); }
  };

  // Handle image upload from BlockEditor (edit mode)
  const handleBlockImageUpload = async (_blockId: string, file: File): Promise<string | null> => {
    if (!editSlug) return null;
    return uploadImageToSlug(editSlug, file);
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setSubmitting(true);
    setSubmitStatus(null);
    setPostError(null);
    setPostResult(null);

    try {
      // ── Step 1: Bake image rotations (edit mode) ─────────────────────────
      let blocksToSave = blocks;
      if (editSlug) {
        const rotated = blocks.filter(b => b.type === 'image' && b.rotation);
        if (rotated.length > 0) {
          let done = 0;
          setSubmitStatus(`画像を回転処理中 (0/${rotated.length})...`);
          blocksToSave = await Promise.all(blocks.map(async b => {
            if (b.type === 'image' && b.rotation) {
              const result = await bakeBlockRotation(b, editSlug);
              done++;
              setSubmitStatus(`画像を回転処理中 (${done}/${rotated.length})...`);
              return result;
            }
            return b;
          })) as Block[];
          setBlocks(blocksToSave);
        }
      }

      // ── Step 2: Hero image rotation ───────────────────────────────────────
      let rotatedHero: File | null = null;
      if (heroFile) {
        if (heroRotation) setSubmitStatus('ヒーロー画像を処理中...');
        rotatedHero = await rotateFile(heroFile, heroRotation);
      }

      // ── Step 3: Serialize & send ──────────────────────────────────────────
      setSubmitStatus('記事を保存中...');
      const body = serializeBlocks(blocksToSave);
      const form = new FormData();
      form.append('title', title);
      form.append('body', body);
      form.append('categories', JSON.stringify(selectedCats));
      form.append('tags', JSON.stringify(tags));

      if (editSlug) {
        if (publishedAt) form.append('published_at', publishedAt);
        if (rotatedHero) form.append('hero_image', rotatedHero);
        else if (heroFromExisting) form.append('reuse_image_as_hero', heroFromExisting);
        const updated = await api.articles.update(editSlug, form);
        setPostResult({
          slug: updated.slug,
          bodySizeBytes: new Blob([body]).size,
          blockCount: blocksToSave.length,
          publishedAt: updated.published_at ?? undefined,
        });
      } else {
        if (sourceUrl) form.append('source_url', sourceUrl);
        if (rotatedHero) form.append('hero_image', rotatedHero);

        // Collect pending image files from blocks (new mode two-pass)
        const pendingImages: { file: File; placeholder: string; rotation?: 0|90|180|270 }[] = [];
        const blocksForBody = blocksToSave.map(b => {
          if ((b.type === 'image' || b.type === 'video') && b.pendingFile && !b.src) {
            const placeholder = `pending:${b.id}`;
            pendingImages.push({ file: b.pendingFile, placeholder, rotation: b.type === 'image' ? b.rotation : undefined });
            return { ...b, src: placeholder, pendingFile: undefined };
          }
          return b;
        }) as Block[];

        const bodyWithPlaceholders = serializeBlocks(blocksForBody);
        form.set('body', bodyWithPlaceholders);

        const created = await api.articles.create(form);
        let finalBody = bodyWithPlaceholders;

        // Upload pending images (canvas-rotate if needed) sequentially for accurate status
        for (let i = 0; i < pendingImages.length; i++) {
          const { file, placeholder, rotation } = pendingImages[i];
          setSubmitStatus(`画像をアップロード中 (${i + 1}/${pendingImages.length})...`);
          const fileToUpload = rotation ? await rotateFile(file, rotation) : file;
          const relPath = await uploadImageToSlug(created.slug, fileToUpload);
          if (relPath) finalBody = finalBody.split(placeholder).join(relPath);
        }

        if (finalBody !== bodyWithPlaceholders) {
          setSubmitStatus('記事を更新中...');
          const updateForm = new FormData();
          updateForm.append('body', finalBody);
          await api.articles.update(created.slug, updateForm);
        }

        setPostResult({
          slug: created.slug,
          bodySizeBytes: new Blob([finalBody]).size,
          blockCount: blocksToSave.length,
          publishedAt: created.published_at ?? undefined,
        });
      }
    } catch (err) {
      setPostError(err instanceof Error ? err.message : '投稿に失敗しました');
    } finally {
      setSubmitting(false);
      setSubmitStatus(null);
    }
  };

  const labelCls = 'block text-sm font-medium text-slate-400 mb-1';

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 pb-32">
      {/* Sticky header */}
      <div className="sticky top-0 z-30 bg-canvas/95 backdrop-blur border-b border-rim pb-3 mb-6 -mx-4 px-4 pt-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="text-slate-400 hover:text-slate-200 text-sm"
            aria-label="戻る"
          >
            ←
          </button>
          <h2 className="flex-1 font-display text-2xl tracking-wide text-slate-100">
            {editSlug ? '記事を編集' : '新しい記事を投稿'}
          </h2>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || !title.trim()}
            className="btn btn-solid disabled:opacity-50 min-w-[7rem] text-left"
          >
            {submitting ? (submitStatus ?? '準備中...') : editSlug ? '更新する' : '投稿する'}
          </button>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">

        {/* Hero image */}
        <div>
          <label className={labelCls}>
            ヒーロー画像
            {editSlug && heroPreview && !heroFile && (
              <span className="text-xs text-slate-600 font-normal ml-2">現在の画像（タップで変更）</span>
            )}
          </label>
          <div
            ref={heroDrop}
            onDragOver={e => e.preventDefault()}
            onDrop={handleHeroDrop}
            className="relative border-2 border-dashed border-rim2 rounded-xl overflow-hidden cursor-pointer hover:border-amber-500 transition-colors"
            style={{ minHeight: 140 }}
            onClick={() => document.getElementById('hero-input')?.click()}
          >
            {heroPreview ? (
              <div className="relative overflow-hidden">
                <img
                  src={heroPreview}
                  alt="preview"
                  className="w-full h-44 object-cover"
                  style={heroRotation ? { transform: `rotate(${heroRotation}deg)` } : undefined}
                />
                <button
                  type="button"
                  onClick={e => { e.stopPropagation(); handleHeroRotate(); }}
                  className="absolute top-2 left-2 bg-black/60 text-white text-sm px-2 py-1 rounded-lg z-10"
                  title="時計回りに回転"
                >
                  ↻
                </button>
                {heroFile && (
                  <span className="absolute top-2 right-2 bg-amber-500 text-black text-xs font-semibold px-2 py-0.5 rounded-lg">
                    新しい画像
                  </span>
                )}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-36 text-slate-500">
                <svg className="w-10 h-10 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <p className="text-sm">タップして選択</p>
              </div>
            )}
            <input id="hero-input" type="file" accept="image/*" onChange={handleHeroInput} className="hidden" />
          </div>
        </div>

        {/* Title */}
        <div>
          <label className={labelCls}>タイトル <span className="text-red-400">*</span></label>
          <input
            type="text"
            required
            value={title}
            onChange={e => setTitle(e.target.value)}
            className={`${inputCls} text-lg font-semibold`}
            placeholder="記事タイトル"
          />
        </div>

        {/* Published date (edit only) */}
        {editSlug && (
          <div className="max-w-xs">
            <label className={labelCls}>公開日時</label>
            <input
              type="datetime-local"
              value={publishedAt}
              onChange={e => setPublishedAt(e.target.value)}
              className={inputCls}
            />
          </div>
        )}

        {/* Block editor */}
        <div>
          <label className={labelCls}>本文</label>
          <div className="mt-1 pl-5">
            <BlockEditor
              blocks={blocks}
              onChange={setBlocks}
              editSlug={editSlug ?? undefined}
              onUploadImage={handleBlockImageUpload}
            />
          </div>
        </div>

        {/* Categories */}
        <div>
          <div className="flex items-center gap-3 mb-2">
            <label className="text-sm font-medium text-slate-400">カテゴリー</label>
            <button
              type="button"
              onClick={handleAiClassify}
              disabled={classifying || !title}
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
            <div className="mb-3 space-y-2">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleAiComment}
                  disabled={commenting}
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
            {categories.map(cat => (
              <button
                key={cat.slug}
                type="button"
                onClick={() => toggleCat(cat.slug)}
                className={`btn ${selectedCats.includes(cat.slug) ? 'text-white border-transparent border' : 'btn-outline'}`}
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
            <input
              type="text"
              value={tagInput}
              onChange={e => setTagInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }}
              placeholder="タグを入力 → Enter"
              className={inputCls}
            />
            <button type="button" onClick={addTag} className="btn btn-outline">追加</button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {tags.map(tag => (
              <span key={tag} className="inline-flex items-center gap-1 text-xs bg-surface2 text-slate-300 px-2 py-0.5 rounded-full">
                #{tag}
                <button
                  type="button"
                  onClick={() => setTags(p => p.filter(t => t !== tag))}
                  className="text-slate-500 hover:text-red-400 transition-colors"
                >×</button>
              </span>
            ))}
          </div>
        </div>

        {/* Source URL (new mode only) */}
        {!editSlug && (
          <div>
            <label className={labelCls}>ソースURL（任意）</label>
            <input
              type="url"
              value={sourceUrl}
              onChange={e => setSourceUrl(e.target.value)}
              className={inputCls}
              placeholder="https://..."
            />
          </div>
        )}

        {/* Bottom submit (mirrors the sticky header button) */}
        <div className="pt-2 flex justify-end">
          <button
            type="submit"
            disabled={submitting || !title.trim()}
            className="btn btn-solid disabled:opacity-50 min-w-[7rem] text-left"
          >
            {submitting ? (submitStatus ?? '準備中...') : editSlug ? '更新する' : '投稿する'}
          </button>
        </div>

      </form>

      {/* Post result banner */}
      <PostResultBanner
        success={postResult ?? undefined}
        error={postError ?? undefined}
        onContinueEditing={() => { setPostResult(null); setPostError(null); }}
        onViewArticle={() => postResult && navigate(`/articles/${postResult.slug}`)}
        onGoToList={() => navigate('/')}
        onRetry={() => handleSubmit()}
      />
    </div>
  );
}
