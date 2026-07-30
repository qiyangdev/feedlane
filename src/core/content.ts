import { DefuddleClass } from "defuddle/node";
import { parseHTML } from "linkedom";
import sanitizeHtml from "sanitize-html";

const DEFAULT_MAX_CONTENT_BYTES = 128 * 1024;

const allowedTags = [
  "a",
  "article",
  "b",
  "blockquote",
  "br",
  "code",
  "del",
  "details",
  "div",
  "em",
  "figcaption",
  "figure",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "i",
  "img",
  "kbd",
  "li",
  "main",
  "mark",
  "ol",
  "p",
  "pre",
  "s",
  "section",
  "span",
  "strong",
  "sub",
  "summary",
  "sup",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "u",
  "ul",
];

export interface ExtractReadableContentInput {
  html: string;
  pageUrl: URL;
  contentSelector?: string;
  maxContentBytes?: number;
}

export interface ExtractedPageContent {
  contentHtml: string;
  title?: string;
  author?: string;
  description?: string;
  language?: string;
  publishedAt?: Date;
  wordCount?: number;
}

export function extractReadableContent(
  input: ExtractReadableContentInput,
): ExtractedPageContent | undefined {
  const { document } = parseHTML(input.html);
  const result = new DefuddleClass(document as unknown as Document, {
    url: input.pageUrl.toString(),
    ...(input.contentSelector === undefined ? {} : { contentSelector: input.contentSelector }),
    includeReplies: false,
    removeImages: false,
    useAsync: false,
  }).parse();

  const contentHtml = sanitizeExtractedHtml(result.content, input.pageUrl);
  const maxContentBytes = input.maxContentBytes ?? DEFAULT_MAX_CONTENT_BYTES;
  if (
    contentHtml === "" ||
    !Number.isSafeInteger(maxContentBytes) ||
    maxContentBytes <= 0 ||
    Buffer.byteLength(contentHtml, "utf8") > maxContentBytes
  ) {
    return undefined;
  }

  const publishedAt = parseOptionalDate(result.published);
  return {
    contentHtml,
    ...optionalText("title", result.title),
    ...optionalText("author", result.author),
    ...optionalText("description", result.description),
    ...optionalText("language", result.language),
    ...(publishedAt === undefined ? {} : { publishedAt }),
    ...(Number.isSafeInteger(result.wordCount) && result.wordCount >= 0
      ? { wordCount: result.wordCount }
      : {}),
  };
}

function sanitizeExtractedHtml(value: string, pageUrl: URL): string {
  const sanitized = sanitizeHtml(value, {
    allowedTags,
    allowedAttributes: {
      a: ["href", "title", "rel"],
      blockquote: ["cite"],
      code: ["data-lang"],
      img: ["src", "alt", "title", "width", "height", "loading"],
      td: ["colspan", "rowspan"],
      th: ["colspan", "rowspan", "scope"],
    },
    allowedSchemes: ["http", "https"],
    allowProtocolRelative: false,
    disallowedTagsMode: "discard",
    transformTags: {
      a(tagName, attributes) {
        const href = resolveHttpUrl(attributes.href, pageUrl);
        if (href === undefined) {
          return { tagName: "span", attribs: {} };
        }
        return {
          tagName,
          attribs: {
            ...attributes,
            href,
            rel: "nofollow noopener noreferrer",
          },
        };
      },
      img(tagName, attributes) {
        const src = resolveHttpUrl(attributes.src, pageUrl);
        return {
          tagName,
          attribs: {
            ...attributes,
            ...(src === undefined ? { src: "" } : { src }),
            loading: "lazy",
          },
        };
      },
    },
    exclusiveFilter(frame) {
      return frame.tag === "img" && frame.attribs.src === "";
    },
  }).trim();

  const text = sanitizeHtml(sanitized, { allowedTags: [], allowedAttributes: {} }).trim();
  return text === "" && !/<img\s/i.test(sanitized) ? "" : sanitized;
}

function resolveHttpUrl(value: string | undefined, baseUrl: URL): string | undefined {
  if (value === undefined || value.trim() === "") return undefined;

  try {
    const url = new URL(value, baseUrl);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username !== "" ||
      url.password !== ""
    ) {
      return undefined;
    }
    return url.toString();
  } catch {
    return undefined;
  }
}

function optionalText<Key extends "title" | "author" | "description" | "language">(
  key: Key,
  value: string,
): Partial<Record<Key, string>> {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized === "" ? {} : ({ [key]: normalized } as Partial<Record<Key, string>>);
}

function parseOptionalDate(value: string): Date | undefined {
  if (value.trim() === "") return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}
