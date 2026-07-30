import {
  UpstreamNotFoundError,
  UpstreamRateLimitError,
  UpstreamResponseError,
  ValidationError,
} from "./errors.js";

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const DEFAULT_USER_AGENT = "Feedlane/0.1 (+https://github.com/feedlane/feedlane)";

export interface JsonRequestOptions {
  allowedHosts: readonly string[];
  accept?: string;
  token?: string;
  timeoutMs?: number;
  maxResponseBytes?: number;
}

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
    const url = validateTarget(urlInput, options.allowedHosts);
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;

    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
      throw new ValidationError("The upstream timeout must be a positive integer.");
    }
    if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes <= 0) {
      throw new ValidationError("The response size limit must be a positive integer.");
    }

    const headers = new Headers({
      Accept: options.accept ?? "application/json",
      "User-Agent": this.#userAgent,
    });
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

    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (!contentType.includes("application/json") && !contentType.includes("+json")) {
      throw new UpstreamResponseError("The upstream service did not return JSON.");
    }

    try {
      return JSON.parse(body) as unknown;
    } catch (error) {
      throw new UpstreamResponseError("The upstream service returned malformed JSON.", {
        cause: error,
      });
    }
  }
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
