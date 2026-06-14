export interface Category {
  id: string;
  slug: string;
  name_en: string;
  name_ja: string;
  color: string;
  article_count: number;
}

export interface Tag {
  id: string;
  slug: string;
  name: string;
  article_count: number;
}

export interface ArticleCard {
  id: string;
  slug: string;
  title: string;
  hero_image: string | null;
  categories: string[];
  tags: string[];
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Article extends ArticleCard {
  body: string;
  source_url: string | null;
  updated_at: string;
  ai_comment: string | null;
  ai_comment_model: string | null;
  body_size_bytes: number;
}

export interface ArticleListResponse {
  items: ArticleCard[];
  total: number;
  page: number;
  limit: number;
}

export interface ImportAnalyzeResponse {
  url: string;
  article_count: number;
  sample_titles: string[];
  detected_categories: string[];
  method: string;
}

export interface CategoryCreate {
  slug: string;
  name_en: string;
  name_ja: string;
  color: string;
}

export interface ShopifyBlog {
  id: string;
  title: string;
  handle: string;
  article_count: number;
}

export interface ShopifyBlogsResponse {
  blogs: ShopifyBlog[];
}
