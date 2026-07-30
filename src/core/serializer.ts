import { Feed, type FeedOptions, type Item } from "feed";

import { SerializationError, ValidationError } from "./errors.js";
import type { FeedDocument, FeedItem } from "./feed.js";

export const feedFormats = ["rss", "atom", "json"] as const;
export type FeedFormat = (typeof feedFormats)[number];

const contentTypes: Record<FeedFormat, string> = {
  rss: "application/rss+xml; charset=utf-8",
  atom: "application/atom+xml; charset=utf-8",
  json: "application/feed+json; charset=utf-8",
};

export interface SerializedFeed {
  body: string;
  contentType: string;
}

export function serializeFeedDocument(document: FeedDocument, format: FeedFormat): SerializedFeed {
  try {
    assertValidDocument(document);
    const options: FeedOptions = {
      title: document.title,
      id: document.homeUrl,
      link: document.homeUrl,
      feed: document.feedUrl,
      feedLinks: buildFeedLinks(document.feedUrl),
      generator: "Feedlane",
      ...(document.description === undefined ? {} : { description: document.description }),
      ...(document.language === undefined ? {} : { language: document.language }),
      ...(document.updatedAt === undefined ? {} : { updated: document.updatedAt }),
    };
    const feed = new Feed(options);

    for (const item of document.items) {
      feed.addItem(toFeedItem(item));
    }

    const body = format === "rss" ? feed.rss2() : format === "atom" ? feed.atom1() : feed.json1();
    return { body, contentType: contentTypes[format] };
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    throw new SerializationError({ cause: error });
  }
}

function toFeedItem(item: FeedItem): Item {
  return {
    id: toAbsoluteItemId(item),
    guid: item.id,
    title: item.title,
    link: item.url,
    date: item.updatedAt ?? item.publishedAt,
    published: item.publishedAt,
    ...(item.description === undefined ? {} : { description: item.description }),
    ...(item.contentHtml === undefined ? {} : { content: item.contentHtml }),
    ...(item.authors === undefined
      ? {}
      : {
          author: item.authors.map((author) => ({
            name: author.name,
            ...(author.url === undefined ? {} : { link: author.url }),
          })),
        }),
    ...(item.categories === undefined
      ? {}
      : { category: item.categories.map((name) => ({ name })) }),
    ...(item.enclosure === undefined ? {} : { enclosure: item.enclosure }),
  };
}

function toAbsoluteItemId(item: FeedItem): string {
  try {
    return new URL(item.id).toString();
  } catch {
    return item.url;
  }
}

function buildFeedLinks(feedUrl: string): NonNullable<FeedOptions["feedLinks"]> {
  const url = new URL(feedUrl);
  const linkFor = (format: FeedFormat): string => {
    const link = new URL(url);
    link.searchParams.set("format", format);
    return link.toString();
  };
  return { rss: linkFor("rss"), atom: linkFor("atom"), json: linkFor("json") };
}

function assertValidDocument(document: FeedDocument): void {
  if (
    document.title.trim() === "" ||
    document.homeUrl.trim() === "" ||
    document.feedUrl.trim() === ""
  ) {
    throw new ValidationError("The feed document is missing required metadata.");
  }
  for (const item of document.items) {
    if (
      Number.isNaN(item.publishedAt.getTime()) ||
      (item.updatedAt !== undefined && Number.isNaN(item.updatedAt.getTime()))
    ) {
      throw new ValidationError("A feed item contains an invalid date.");
    }
  }
}
