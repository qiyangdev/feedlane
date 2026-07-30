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
  assertHttpUrl(document.homeUrl, "The feed home URL is invalid.");
  assertHttpUrl(document.feedUrl, "The feed URL is invalid.");
  for (const item of document.items) {
    if (item.id.trim() === "" || item.title.trim() === "") {
      throw new ValidationError("A feed item is missing required metadata.");
    }
    assertHttpUrl(item.url, "A feed item URL is invalid.");
    if (
      Number.isNaN(item.publishedAt.getTime()) ||
      (item.updatedAt !== undefined && Number.isNaN(item.updatedAt.getTime()))
    ) {
      throw new ValidationError("A feed item contains an invalid date.");
    }
    for (const author of item.authors ?? []) {
      if (author.name.trim() === "") {
        throw new ValidationError("A feed item author is missing a name.");
      }
      if (author.url !== undefined) {
        assertHttpUrl(author.url, "A feed item author URL is invalid.");
      }
    }
    if (item.enclosure !== undefined) {
      assertHttpUrl(item.enclosure.url, "A feed item enclosure URL is invalid.");
      if (
        item.enclosure.type.trim() === "" ||
        (item.enclosure.length !== undefined &&
          (!Number.isSafeInteger(item.enclosure.length) || item.enclosure.length < 0))
      ) {
        throw new ValidationError("A feed item enclosure is invalid.");
      }
    }
  }
}

function assertHttpUrl(value: string, message: string): void {
  try {
    const url = new URL(value);
    if (
      value.trim() !== value ||
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username !== "" ||
      url.password !== ""
    ) {
      throw new TypeError();
    }
  } catch {
    throw new ValidationError(message);
  }
}
