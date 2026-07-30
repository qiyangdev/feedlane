export interface FeedAuthor {
  name: string;
  url?: string;
}

export interface FeedEnclosure {
  url: string;
  type: string;
  length?: number;
}

export interface FeedItem {
  id: string;
  title: string;
  url: string;
  description?: string;
  contentHtml?: string;
  publishedAt: Date;
  updatedAt?: Date;
  authors?: FeedAuthor[];
  categories?: string[];
  enclosure?: FeedEnclosure;
}

export interface FeedDocument {
  title: string;
  description?: string;
  homeUrl: string;
  feedUrl: string;
  language?: string;
  updatedAt?: Date;
  items: FeedItem[];
}
