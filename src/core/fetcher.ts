import {
  UpstreamNotFoundError,
  UpstreamRateLimitError,
  UpstreamResponseError,
  ValidationError,
} from "./errors.js";

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const DEFAULT_USER_AGENT = "Feedlane/0.1 (+https://github.com/qiyangdev/feedlane)";
const RESERVED_HEADERS = new Set(["accept", "authorization", "host", "user-agent"]);

export interface HttpRequestOptions {
  allowedHosts: readonly string[];
  accept?: string;
  token?: string;
  additionalHeaders?: Readonly<Record<string, string>>;
  timeoutMs?: number;
  maxResponseBytes?: number;
}

export type JsonRequestOptions = HttpRequestOptions;
export type HtmlRequestOptions = HttpRequestOptions;

export interface FetcherOptions {
  fetch?: typeof globalThis.fetch;
  userAgent?: string;
}

export class HttpFetcher {
  readonly #fetch: typeof globalThis.fetch;
  readonly #userAgent: string;

  constructor(options: FetcherOptions = {}) {
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
  }

  async json(urlInput: string | URL, options: JsonRequestOptions): Promise<unknown> {
    const response = await this.#request(urlInput, options, "application/json");
    if (!isJsonMediaType(response.contentType)) {
      throw new UpstreamResponseError("The upstream service did not return JSON.");
    }

    try {
      return JSON.parse(response.body) as unknown;
    } catch (error) {
      throw new UpstreamResponseError("The upstream service returned malformed JSON.", {
        cause: error,
      });
    }
  }

  async html(urlInput: string | URL, options: HtmlRequestOptions): Promise<string> {
    const response = await this.#request(urlInput, options, "text/html, application/xhtml+xml");
    if (!isHtmlMediaType(response.contentType)) {
      throw new UpstreamResponseError("The upstream service did not return HTML.");
    }
    return response.body;
  }

  async #request(
    urlInput: string | URL,
    options: HttpRequestOptions,
    defaultAccept: string,
  ): Promise<{ body: string; contentType: string }> {
    const url = validateTarget(urlInput, options.allowedHosts);
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;

    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
      throw new ValidationError("The upstream timeout must be a positive integer.");
    }
    if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes <= 0) {
      throw new ValidationError("The response size limit must be a positive integer.");
    }

    const headers = new Headers();
    for (const [name, value] of Object.entries(options.additionalHeaders ?? {})) {
      if (RESERVED_HEADERS.has(name.toLowerCase())) {
        throw new ValidationError(`Header '${name}' cannot be overridden.`);
      }
      headers.set(name, value);
    }
    headers.set("Accept", options.accept ?? defaultAccept);
    headers.set("User-Agent", this.#userAgent);
    if (options.token !== undefined && options.token.length > 0) {
      headers.set("Authorization", `Bearer ${options.token}`);
    }

    let response: Response;
    try {
      response = await this.#fetch(url, {
        method: "GET",
        headers,
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const message =
        error instanceof DOMException && error.name === "TimeoutError"
          ? "The upstream request timed out."
          : "The upstream service could not be reached.";
      throw new UpstreamResponseError(message, { cause: error });
    }

    const body = await readLimitedBody(response, maxResponseBytes);

    if (response.status === 404) {
      throw new UpstreamNotFoundError();
    }
    if (
      response.status === 429 ||
      (response.status === 403 && response.headers.get("x-ratelimit-remaining") === "0")
    ) {
      throw new UpstreamRateLimitError();
    }
    if (!response.ok) {
      throw new UpstreamResponseError(`The upstream service returned HTTP ${response.status}.`);
    }

    return {
      body,
      contentType: response.headers.get("content-type")?.toLowerCase() ?? "",
    };
  }
}

function isJsonMediaType(contentType: string): boolean {
  const mediaType = contentType.split(";", 1)[0]?.trim();
  return mediaType === "application/json" || mediaType?.endsWith("+json") === true;
}

function isHtmlMediaType(contentType: string): boolean {
  const mediaType = contentType.split(";", 1)[0]?.trim();
  return mediaType === "text/html" || mediaType === "application/xhtml+xml";
}

function validateTarget(urlInput: string | URL, allowedHosts: readonly string[]): URL {
  let url: URL;
  try {
    url = new URL(urlInput);
  } catch {
    throw new ValidationError("The upstream URL is invalid.");
  }

  if (url.protocol !== "https:") {
    throw new ValidationError("Only HTTPS upstream URLs are allowed.");
  }
  if (url.username !== "" || url.password !== "" || (url.port !== "" && url.port !== "443")) {
    throw new ValidationError("The upstream URL contains disallowed authority components.");
  }

  const allowed = new Set(allowedHosts.map((host) => host.toLowerCase()));
  if (!allowed.has(url.hostname.toLowerCase())) {
    throw new ValidationError("The upstream host is not allowed for this route.");
  }
  return url;
}

async function readLimitedBody(response: Response, maxBytes: number): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new UpstreamResponseError("The upstream response exceeded the size limit.");
  }

  if (response.body === null) {
    return "";
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const result = await reader.read();
    if (result.done) break;
    totalBytes += result.value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel();
      throw new UpstreamResponseError("The upstream response exceeded the size limit.");
    }
    chunks.push(result.value);
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}
