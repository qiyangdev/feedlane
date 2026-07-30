import { load } from "cheerio";
import { z } from "zod";

import { extractReadableContent } from "../../core/content.js";
import { UpstreamResponseError } from "../../core/errors.js";
import type { FeedItem } from "../../core/feed.js";
import type { HttpFetcher } from "../../core/fetcher.js";
import { escapeHtml } from "../../core/html.js";
import { defineFeedRoute, type FeedRoute } from "../../core/route.js";

const V2EX_ORIGIN = "https://www.v2ex.com";
const ITEM_LIMIT = 10;
const DETAIL_CONCURRENCY = 4;
const DETAIL_TIMEOUT_MS = 5_000;
const DETAIL_MAX_RESPONSE_BYTES = 1024 * 1024;
const DETAIL_MAX_CONTENT_BYTES = 128 * 1024;

const parameters = z.object({
  tab: z.literal("hot"),
});

type V2exParameters = z.infer<typeof parameters>;

const definition: FeedRoute<V2exParameters> = {
  path: "/v2ex/topics/:tab",
  name: "V2EX hot topics",
  description: "Popular V2EX topics with full original-post content.",
  parameters,
  cacheTtl: 600,
  async handler({ params, requestUrl, fetcher }) {
    const pageUrl = new URL("/", V2EX_ORIGIN);
    pageUrl.searchParams.set("tab", params.tab);

    const html = await fetcher.html(pageUrl, {
      allowedHosts: ["www.v2ex.com"],
    });
    const topics = parseTopics(html).slice(0, ITEM_LIMIT);
    const firstTopic = topics[0];
    if (firstTopic === undefined) {
      throw new UpstreamResponseError("V2EX returned an unexpected page.");
    }

    const enrichedTopics = await mapInBatches(topics, DETAIL_CONCURRENCY, (topic) =>
      enrichTopic(topic, fetcher),
    );
    if (!enrichedTopics.some((topic) => topic.enriched)) {
      throw new UpstreamResponseError("V2EX topic details could not be parsed.");
    }
    const items = enrichedTopics.map((topic) => topic.item);
    const firstItem = items[0] ?? firstTopic.item;

    return {
      title: "V2EX: Hot Topics",
      description: "Popular topics from the V2EX hot tab with original-post content.",
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

interface ParsedTopic {
  id: string;
  nodeName: string;
  nodeUrl: string;
  author: string;
  authorUrl: string;
  replies: number;
  item: FeedItem;
}

interface EnrichedTopic {
  item: FeedItem;
  enriched: boolean;
}

function parseTopics(html: string): ParsedTopic[] {
  const $ = load(html);
  const topics: ParsedTopic[] = [];

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
    const metadata = {
      title,
      topicUrl: topicUrl.toString(),
      nodeName,
      nodeUrl: nodeUrl.toString(),
      author,
      authorUrl: authorUrl.toString(),
      replies,
      activityAt,
    };
    topics.push({
      id: topicId,
      nodeName,
      nodeUrl: nodeUrl.toString(),
      author,
      authorUrl: authorUrl.toString(),
      replies,
      item: {
        id: topicUrl.toString(),
        title,
        url: topicUrl.toString(),
        description,
        contentHtml: renderTopicSummary(metadata),
        // Replaced with the creation time when detail enrichment succeeds.
        publishedAt: activityAt,
        updatedAt: activityAt,
        authors: [{ name: author, url: authorUrl.toString() }],
        categories: ["hot", nodeName],
      },
    });
  });

  return topics;
}

async function enrichTopic(topic: ParsedTopic, fetcher: HttpFetcher): Promise<EnrichedTopic> {
  try {
    const detailUrl = new URL(topic.item.url);
    const html = await fetcher.html(detailUrl, {
      allowedHosts: ["www.v2ex.com"],
      timeoutMs: DETAIL_TIMEOUT_MS,
      maxResponseBytes: DETAIL_MAX_RESPONSE_BYTES,
    });
    const $ = load(html);
    if ($(`[id="topic_${topic.id}_votes"]`).length !== 1 || $(".topic_content").length !== 1) {
      return { item: topic.item, enriched: false };
    }

    const publishedAt = parseV2exDate(
      $(".box .header small.gray span[title]").first().attr("title"),
    );
    const content = extractReadableContent({
      html,
      pageUrl: detailUrl,
      contentSelector: ".topic_content",
      maxContentBytes: DETAIL_MAX_CONTENT_BYTES,
    });
    if (publishedAt === undefined || content === undefined) {
      return { item: topic.item, enriched: false };
    }

    return {
      enriched: true,
      item: {
        ...topic.item,
        publishedAt,
        contentHtml: `${content.contentHtml}<hr>${renderTopicMetadata({
          nodeName: topic.nodeName,
          nodeUrl: topic.nodeUrl,
          author: topic.author,
          authorUrl: topic.authorUrl,
          replies: topic.replies,
          activityAt: topic.item.updatedAt ?? topic.item.publishedAt,
        })}`,
      },
    };
  } catch {
    return { item: topic.item, enriched: false };
  }
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

function renderTopicSummary(input: {
  title: string;
  topicUrl: string;
  nodeName: string;
  nodeUrl: string;
  author: string;
  authorUrl: string;
  replies: number;
  activityAt: Date;
}): string {
  return `<p><a href="${escapeHtml(input.topicUrl)}">${escapeHtml(input.title)}</a></p>${renderTopicMetadata(input)}`;
}

function renderTopicMetadata(input: {
  nodeName: string;
  nodeUrl: string;
  author: string;
  authorUrl: string;
  replies: number;
  activityAt: Date;
}): string {
  const replyLabel = input.replies === 1 ? "reply" : "replies";
  const timestamp = input.activityAt.toISOString();
  return `<p><a href="${escapeHtml(input.nodeUrl)}">${escapeHtml(input.nodeName)}</a> · by <a href="${escapeHtml(input.authorUrl)}">${escapeHtml(input.author)}</a> · ${input.replies} ${replyLabel} · last active <time datetime="${escapeHtml(timestamp)}">${escapeHtml(timestamp)}</time></p>`;
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

async function mapInBatches<Input, Output>(
  values: readonly Input[],
  batchSize: number,
  mapper: (value: Input) => Promise<Output>,
): Promise<Output[]> {
  const results: Output[] = [];
  for (let index = 0; index < values.length; index += batchSize) {
    results.push(...(await Promise.all(values.slice(index, index + batchSize).map(mapper))));
  }
  return results;
}
