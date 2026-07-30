const DEFAULT_DURATION_BUCKETS_MS = [10, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000];
const STANDARD_HTTP_METHODS = new Set([
  "CONNECT",
  "DELETE",
  "GET",
  "HEAD",
  "OPTIONS",
  "PATCH",
  "POST",
  "PUT",
  "TRACE",
]);

export interface RequestMeasurement {
  method: string;
  route: string;
  status: number;
  durationMs: number;
  errorCode?: string;
}

interface RequestCounter {
  method: string;
  route: string;
  statusGroup: string;
  value: number;
}

interface DurationHistogram {
  method: string;
  route: string;
  bucketCounts: number[];
  count: number;
  sumMs: number;
}

export class RequestMetrics {
  readonly #durationBucketsMs: readonly number[];
  readonly #requestCounters = new Map<string, RequestCounter>();
  readonly #durationHistograms = new Map<string, DurationHistogram>();
  readonly #errorCounters = new Map<string, number>();
  readonly #startedAtSeconds: number;

  constructor(options: { durationBucketsMs?: readonly number[]; startedAt?: Date } = {}) {
    this.#durationBucketsMs = validateBuckets(
      options.durationBucketsMs ?? DEFAULT_DURATION_BUCKETS_MS,
    );
    this.#startedAtSeconds = (options.startedAt ?? new Date()).getTime() / 1_000;
  }

  record(measurement: RequestMeasurement): void {
    const method = normalizeMethod(measurement.method);
    const durationMs = normalizeDuration(measurement.durationMs);
    const statusGroup = `${Math.floor(measurement.status / 100)}xx`;
    const counterKey = JSON.stringify([method, measurement.route, statusGroup]);
    const existingCounter = this.#requestCounters.get(counterKey);
    if (existingCounter === undefined) {
      this.#requestCounters.set(counterKey, {
        method,
        route: measurement.route,
        statusGroup,
        value: 1,
      });
    } else {
      existingCounter.value += 1;
    }

    const histogramKey = JSON.stringify([method, measurement.route]);
    const histogram = this.#durationHistograms.get(histogramKey) ?? {
      method,
      route: measurement.route,
      bucketCounts: this.#durationBucketsMs.map(() => 0),
      count: 0,
      sumMs: 0,
    };
    histogram.count += 1;
    histogram.sumMs += durationMs;
    for (const [index, boundary] of this.#durationBucketsMs.entries()) {
      if (durationMs <= boundary) {
        histogram.bucketCounts[index] = (histogram.bucketCounts[index] ?? 0) + 1;
      }
    }
    this.#durationHistograms.set(histogramKey, histogram);

    if (measurement.errorCode !== undefined) {
      this.#errorCounters.set(
        measurement.errorCode,
        (this.#errorCounters.get(measurement.errorCode) ?? 0) + 1,
      );
    }
  }

  renderPrometheus(): string {
    const lines = [
      "# HELP feedlane_process_start_time_seconds Start time of this Feedlane instance.",
      "# TYPE feedlane_process_start_time_seconds gauge",
      `feedlane_process_start_time_seconds ${this.#startedAtSeconds}`,
      "# HELP feedlane_http_requests_total HTTP requests handled by this instance.",
      "# TYPE feedlane_http_requests_total counter",
    ];

    for (const counter of [...this.#requestCounters.values()].sort(compareMetricLabels)) {
      lines.push(
        `feedlane_http_requests_total${labels({ method: counter.method, route: counter.route, status: counter.statusGroup })} ${counter.value}`,
      );
    }

    lines.push(
      "# HELP feedlane_http_request_duration_seconds HTTP request duration on this instance.",
      "# TYPE feedlane_http_request_duration_seconds histogram",
    );
    for (const histogram of [...this.#durationHistograms.values()].sort(compareMetricLabels)) {
      for (const [index, boundary] of this.#durationBucketsMs.entries()) {
        lines.push(
          `feedlane_http_request_duration_seconds_bucket${labels({ method: histogram.method, route: histogram.route, le: String(boundary / 1_000) })} ${histogram.bucketCounts[index] ?? 0}`,
        );
      }
      lines.push(
        `feedlane_http_request_duration_seconds_bucket${labels({ method: histogram.method, route: histogram.route, le: "+Inf" })} ${histogram.count}`,
        `feedlane_http_request_duration_seconds_sum${labels({ method: histogram.method, route: histogram.route })} ${histogram.sumMs / 1_000}`,
        `feedlane_http_request_duration_seconds_count${labels({ method: histogram.method, route: histogram.route })} ${histogram.count}`,
      );
    }

    lines.push(
      "# HELP feedlane_http_request_errors_total HTTP errors handled by this instance.",
      "# TYPE feedlane_http_request_errors_total counter",
    );
    for (const [code, value] of [...this.#errorCounters.entries()].sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      lines.push(`feedlane_http_request_errors_total${labels({ code })} ${value}`);
    }

    return `${lines.join("\n")}\n`;
  }
}

function normalizeMethod(method: string): string {
  const normalized = method.toUpperCase();
  return STANDARD_HTTP_METHODS.has(normalized) ? normalized : "OTHER";
}

function validateBuckets(buckets: readonly number[]): readonly number[] {
  if (
    buckets.length === 0 ||
    buckets.some((value) => !Number.isFinite(value) || value <= 0) ||
    buckets.some((value, index) => index > 0 && value <= (buckets[index - 1] ?? 0))
  ) {
    throw new TypeError("Metric duration buckets must be positive and strictly increasing.");
  }
  return [...buckets];
}

function normalizeDuration(durationMs: number): number {
  return Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 0;
}

function compareMetricLabels(
  left: { method: string; route: string },
  right: { method: string; route: string },
): number {
  return left.route.localeCompare(right.route) || left.method.localeCompare(right.method);
}

function labels(values: Readonly<Record<string, string>>): string {
  const entries = Object.entries(values).map(
    ([name, value]) => `${name}="${escapeLabelValue(value)}"`,
  );
  return `{${entries.join(",")}}`;
}

function escapeLabelValue(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("\n", "\\n").replaceAll('"', '\\"');
}
