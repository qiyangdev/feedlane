import { load } from "cheerio";
import { z } from "zod";

import { UpstreamResponseError } from "../../core/errors.js";
import type { FeedItem } from "../../core/feed.js";
import { escapeHtml } from "../../core/html.js";
import { defineFeedRoute, type FeedRoute } from "../../core/route.js";

const V2EX_ORIGIN = "https://www.v2ex.com";

const parameters = z.object({
  tab: z.literal("hot"),
});

type V2exParameters = z.infer<typeof parameters>;

const definition: FeedRoute<V2exParameters> = {
  path: "/v2ex/topics/:tab",
  name: "V2EX hot topics",
  description: "Popular V2EX topics parsed from the public hot tab.",
  parameters,
  cacheTtl: 300,
  async handler({ params, requestUrl, fetcher }) {
    const pageUrl = new URL("/", V2EX_ORIGIN);
    pageUrl.searchParams.set("tab", params.tab);

    const html = await fetcher.html(pageUrl, {
      allowedHosts: ["www.v2ex.com"],
    });
    const items = parseTopics(html);
    const firstItem = items[0];
    if (firstItem === undefined) {
      throw new UpstreamResponseError("V2EX returned an unexpected page.");
    }

    return {
      title: "V2EX: Hot Topics",
      description: "Popular topics from the V2EX hot tab.",
      homeUrl: pageUrl.toString(),
      feedUrl: requestUrl.toString(),
      language: "zh-CN",
      updatedAt: items
        .slice(1)
        .reduce(
          (latest, item) =>
            item.updatedAt !== undefined && item.updatedAt > latest ? item.updatedAt : latest,
          firstItem.updatedAt ?? firstItem.publishedAt,
        ),
      items,
    };
  },
};

export const v2exTopicsRoute = defineFeedRoute(definition);

function parseTopics(html: string): FeedItem[] {
  const $ = load(html);
  const items: FeedItem[] = [];

  $(".cell.item").each((_index, element) => {
    const row = $(element);
    const titleLink = row.find(".item_title > a.topic-link").first();
    const title = normalizeText(titleLink.text());
    const topicUrl = resolveV2exUrl(titleLink.attr("href"), /^\/t\/(\d+)$/);
    const topicId = topicUrl?.pathname.match(/^\/t\/(\d+)$/)?.[1];

    const nodeLink = row.find(".topic_info > a.node").first();
    const nodeName = normalizeText(nodeLink.text());
    const nodeUrl = resolveV2exUrl(nodeLink.attr("href"), /^\/go\/[A-Za-z0-9_-]+$/);

    const authorLink = row.find('.topic_info strong > a[href^="/member/"]').first();
    const author = normalizeText(authorLink.text());
    const authorUrl = resolveV2exUrl(authorLink.attr("href"), /^\/member\/[A-Za-z0-9_-]+$/);

    const activityAt = parseV2exDate(row.find(".topic_info span[title]").first().attr("title"));
    const replyText = normalizeText(row.find("a.count_livid, a.count_orange").first().text());
    const replies = replyText === "" ? 0 : /^\d+$/.test(replyText) ? Number(replyText) : undefined;

    if (
      title === "" ||
      topicUrl === undefined ||
      topicId === undefined ||
      nodeName === "" ||
      nodeUrl === undefined ||
      author === "" ||
      authorUrl === undefined ||
      activityAt === undefined ||
      replies === undefined
    ) {
      return;
    }

    const description = `${nodeName} · ${author} · ${replies} ${replies === 1 ? "reply" : "replies"}`;
    items.push({
      id: topicUrl.toString(),
      title,
      url: topicUrl.toString(),
      description,
      contentHtml: renderTopicContent({
        title,
        topicUrl: topicUrl.toString(),
        nodeName,
        nodeUrl: nodeUrl.toString(),
        author,
        authorUrl: authorUrl.toString(),
        replies,
        activityAt,
      }),
      // The hot tab exposes the latest activity time, but not the topic creation time.
      publishedAt: activityAt,
      updatedAt: activityAt,
      authors: [{ name: author, url: authorUrl.toString() }],
      categories: ["hot", nodeName],
    });
  });

  return items;
}

function resolveV2exUrl(value: string | undefined, pathnamePattern: RegExp): URL | undefined {
  if (value === undefined) return undefined;

  try {
    const url = new URL(value, V2EX_ORIGIN);
    if (url.origin !== V2EX_ORIGIN || !pathnamePattern.test(url.pathname)) return undefined;
    url.search = "";
    url.hash = "";
    return url;
  } catch {
    return undefined;
  }
}

function parseV2exDate(value: string | undefined): Date | undefined {
  const match = /^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})\s+(Z|[+-]\d{2}:\d{2})$/.exec(
    value?.trim() ?? "",
  );
  if (match === null) return undefined;

  const date = new Date(`${match[1]}T${match[2]}${match[3]}`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function renderTopicContent(input: {
  title: string;
  topicUrl: string;
  nodeName: string;
  nodeUrl: string;
  author: string;
  authorUrl: string;
  replies: number;
  activityAt: Date;
}): string {
  const replyLabel = input.replies === 1 ? "reply" : "replies";
  const timestamp = input.activityAt.toISOString();
  return `<p><a href="${escapeHtml(input.topicUrl)}">${escapeHtml(input.title)}</a></p><p><a href="${escapeHtml(input.nodeUrl)}">${escapeHtml(input.nodeName)}</a> · by <a href="${escapeHtml(input.authorUrl)}">${escapeHtml(input.author)}</a> · ${input.replies} ${replyLabel} · last active <time datetime="${escapeHtml(timestamp)}">${escapeHtml(timestamp)}</time></p>`;
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
