import type { Article, ArticleCard, ArticleListResponse, Category, CategoryCreate, Tag, ImportAnalyzeResponse, ShopifyBlogsResponse } from '../types';

const BASE = '/api';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { credentials: 'include', ...options });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

export const api = {
  articles: {
    list: (params?: Record<string, string | number | undefined>): Promise<ArticleListResponse> => {
      const filtered = params ? Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined)) as Record<string, string> : {};
      const q = Object.keys(filtered).length ? '?' + new URLSearchParams(filtered as Record<string, string>).toString() : '';
      return request(`/articles${q}`);
    },
    get: (slug: string): Promise<Article> => request(`/articles/${slug}`),
    delete: (slug: string): Promise<void> => request(`/articles/${slug}`, { method: 'DELETE' }),
    create: (form: FormData): Promise<Article> =>
      request('/articles', { method: 'POST', body: form }),
    update: (slug: string, form: FormData): Promise<Article> =>
      request(`/articles/${slug}`, { method: 'PUT', body: form }),
    aiCategorize: (): Promise<{ started: boolean }> =>
      request('/articles/ai-categorize', { method: 'POST' }),
    aiCategorizeStatus: (): Promise<{ status: string; progress: string; current_title: string; updated: number; total: number; failed: number }> =>
      request('/articles/ai-categorize/status'),
    aiClassify: (title: string, body: string): Promise<{ categories: string[]; tags: string[] }> =>
      request('/articles/ai-classify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, body }),
      }),
    bulkCategorize: (slugs: string[], add: string[], remove: string[]): Promise<{ updated: number }> =>
      request('/articles/bulk-categorize', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ article_slugs: slugs, add_categories: add, remove_categories: remove }),
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
  shopify: {
    blogs: (shopUrl: string, clientId: string, clientSecret: string): Promise<ShopifyBlogsResponse> =>
      request('/shopify/blogs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shop_url: shopUrl, client_id: clientId, client_secret: clientSecret }),
      }),
  },
  ai: {
    ask: (question: string): Promise<{ answer: string; articles: { title: string; slug: string }[] }> =>
      request('/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question }),
      }),
  },
  auth: {
    login: (email: string, password: string) =>
      fetch(`${BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
        credentials: 'include',
      }),
    logout: () => fetch(`${BASE}/auth/logout`, { method: 'POST', credentials: 'include' }),
    verify: () => fetch(`${BASE}/auth/verify`, { method: 'POST', credentials: 'include' }),
  },
};

export function heroImageUrl(slug: string, heroImage: string | null, updatedAt?: string | null): string | null {
  if (!heroImage) return null;
  const base = `/static/articles/${slug}/${heroImage}`;
  if (updatedAt) {
    const ts = new Date(updatedAt).getTime();
    if (!isNaN(ts)) return `${base}?v=${ts}`;
  }
  return base;
}
