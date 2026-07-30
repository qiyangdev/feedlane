import { load } from "cheerio";
import { z } from "zod";

import type { FeedItem } from "../../core/feed.js";
import { UpstreamResponseError } from "../../core/errors.js";
import { escapeHtml } from "../../core/html.js";
import { defineFeedRoute, type FeedRoute } from "../../core/route.js";

const HACKER_NEWS_ORIGIN = "https://news.ycombinator.com";

const parameters = z.object({
  list: z.enum(["news", "newest", "best"]),
});

type HackerNewsParameters = z.infer<typeof parameters>;

const listMetadata: Record<HackerNewsParameters["list"], { title: string; description: string }> = {
  news: {
    title: "Hacker News",
    description: "Current stories from the Hacker News front page.",
  },
  newest: {
    title: "Hacker News: New Links",
    description: "Newest stories submitted to Hacker News.",
  },
  best: {
    title: "Hacker News: Best Links",
    description: "Most-upvoted Hacker News stories from the last 48 hours.",
  },
};

const definition: FeedRoute<HackerNewsParameters> = {
  path: "/hackernews/:list",
  name: "Hacker News lists",
  description: "Front-page, newest, or best Hacker News stories parsed from HTML.",
  parameters,
  cacheTtl: 300,
  async handler({ params, requestUrl, fetcher }) {
    const listUrl = new URL(`/${params.list}`, HACKER_NEWS_ORIGIN);
    const html = await fetcher.html(listUrl, {
      allowedHosts: ["news.ycombinator.com"],
    });
    const items = parseStories(html, params.list);
    const firstItem = items[0];
    if (firstItem === undefined) {
      throw new UpstreamResponseError("Hacker News returned an unexpected page.");
    }

    const metadata = listMetadata[params.list];
    return {
      title: metadata.title,
      description: metadata.description,
      homeUrl: listUrl.toString(),
      feedUrl: requestUrl.toString(),
      language: "en",
      updatedAt: items
        .slice(1)
        .reduce(
          (latest, item) => (item.publishedAt > latest ? item.publishedAt : latest),
          firstItem.publishedAt,
        ),
      items,
    };
  },
};

export const hackerNewsListsRoute = defineFeedRoute(definition);

function parseStories(html: string, list: HackerNewsParameters["list"]): FeedItem[] {
  const $ = load(html);
  const items: FeedItem[] = [];

  $("tr.athing").each((_index, element) => {
    const row = $(element);
    const id = row.attr("id");
    const titleLink = row.find(".titleline > a").first();
    const title = normalizeText(titleLink.text());
    const storyUrl = resolveHttpUrl(titleLink.attr("href"));
    const subtext = row.next("tr").find(".subtext");
    const publishedAt = parseHackerNewsDate(subtext.find(".age").attr("title"));

    if (id === undefined || !/^\d+$/.test(id) || title === "" || publishedAt === undefined) {
      return;
    }

    const discussionUrl = new URL(`/item?id=${encodeURIComponent(id)}`, HACKER_NEWS_ORIGIN);
    const url = storyUrl ?? discussionUrl.toString();
    const author = normalizeText(subtext.find(".hnuser").first().text());
    const score = normalizeText(subtext.find(".score").first().text());
    let comments = "";
    subtext.find('a[href^="item?id="]').each((_index, element) => {
      const text = normalizeText($(element).text());
      if (text === "discuss" || /comments?$/.test(text)) {
        comments = text;
      }
    });
    const metadata = [score, author === "" ? "" : `by ${author}`, comments].filter(
      (value) => value !== "",
    );
    const description = metadata.length === 0 ? "Discuss on Hacker News." : metadata.join(" · ");

    items.push({
      id: discussionUrl.toString(),
      title,
      url,
      description,
      contentHtml: renderStoryContent({
        title,
        storyUrl: url,
        discussionUrl: discussionUrl.toString(),
        metadata: description,
      }),
      publishedAt,
      ...(author === ""
        ? {}
        : {
            authors: [
              {
                name: author,
                url: new URL(
                  `/user?id=${encodeURIComponent(author)}`,
                  HACKER_NEWS_ORIGIN,
                ).toString(),
              },
            ],
          }),
      categories: [list, new URL(url).hostname],
    });
  });

  return items;
}

function parseHackerNewsDate(value: string | undefined): Date | undefined {
  const datePart = value?.split(/\s+/, 1)[0];
  if (datePart === undefined || datePart === "") return undefined;

  const date = new Date(
    datePart.endsWith("Z") || /[+-]\d{2}:\d{2}$/.test(datePart) ? datePart : `${datePart}Z`,
  );
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function resolveHttpUrl(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  try {
    const url = new URL(value, HACKER_NEWS_ORIGIN);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function renderStoryContent(input: {
  title: string;
  storyUrl: string;
  discussionUrl: string;
  metadata: string;
}): string {
  return `<p><a href="${escapeHtml(input.storyUrl)}">${escapeHtml(input.title)}</a></p><p>${escapeHtml(input.metadata)} · <a href="${escapeHtml(input.discussionUrl)}">Discussion</a></p>`;
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
