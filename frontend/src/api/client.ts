import type { Article, ArticleCard, ArticleListResponse, Category, CategoryCreate, Tag, ImportAnalyzeResponse } from '../types';

const BASE = '/api';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, options);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

export const api = {
  articles: {
    list: (params?: Record<string, string | number>): Promise<ArticleListResponse> => {
      const q = params ? '?' + new URLSearchParams(params as Record<string, string>).toString() : '';
      return request(`/articles${q}`);
    },
    get: (slug: string): Promise<Article> => request(`/articles/${slug}`),
    delete: (slug: string): Promise<void> => request(`/articles/${slug}`, { method: 'DELETE' }),
    create: (form: FormData): Promise<Article> =>
      request('/articles', { method: 'POST', body: form }),
    update: (slug: string, form: FormData): Promise<Article> =>
      request(`/articles/${slug}`, { method: 'PUT', body: form }),
    aiCategorize: (): Promise<Response> =>
      fetch(`${BASE}/articles/ai-categorize`, { method: 'POST' }),
    aiClassify: (title: string, body: string): Promise<{ categories: string[]; tags: string[] }> =>
      request('/articles/ai-classify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, body }),
      }),
  },
  categories: {
    list: (): Promise<Category[]> => request('/categories'),
    tags: (limit = 50): Promise<Tag[]> => request(`/categories/tags?limit=${limit}`),
    create: (data: CategoryCreate): Promise<Category> =>
      request('/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
    delete: (slug: string): Promise<void> =>
      fetch(`${BASE}/categories/${slug}`, { method: 'DELETE' }).then(() => {}),
  },
  search: {
    query: (q: string): Promise<ArticleCard[]> =>
      request(`/search?q=${encodeURIComponent(q)}`),
  },
  importer: {
    analyze: (url: string): Promise<ImportAnalyzeResponse> =>
      request('/import/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      }),
  },
};

export function heroImageUrl(slug: string, heroImage: string | null): string | null {
  if (!heroImage) return null;
  return `/static/articles/${slug}/${heroImage}`;
}
