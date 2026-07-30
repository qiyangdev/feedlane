# Feedlane

Feedlane is a lightweight, route-driven content feed conversion service inspired by RSSHub. A route fetches a narrowly scoped public API or HTML page, converts the result into Feedlane's own domain model, and the shared serializer produces RSS 2.0, Atom 1.0, or JSON Feed 1.0.

The current release is a standalone TypeScript and Hono API for Vercel Functions. It intentionally has no frontend, database, queue, user system, or scheduled jobs.

## Architecture

The dependency flow is deliberately one-way:

```text
Hono application
  -> explicitly composed route registry
    -> typed route handler
      -> FeedDocument
        -> feed serializer adapter
```

`src/core` owns the runtime-independent feed model, route contract, registry, HTTP fetcher, structured logger, request metrics, errors, and the only adapter that imports the `feed` package. Route handlers return `FeedDocument`; they never return third-party serializer objects. Route-specific configuration is captured by route factories instead of being exposed through the core contract. `src/app.ts` is the Hono composition root, while `src/index.ts` is the Vercel-compatible default export.

Routes are registered explicitly in `src/routes/index.ts`. There is no filesystem discovery, dynamic plugin loading, or build-time code generation.

## Requirements

- Node.js 24 LTS
- pnpm 11
- TypeScript 6

The exact package-manager version is recorded in `package.json`, and dependency resolutions are locked in `pnpm-lock.yaml`.

TypeScript is intentionally pinned to 6.0.3. Hono itself is not the constraint: the current Vercel Hono build path still relies on compiler APIs that changed in TypeScript 7. Upgrade this pin only after validating a production Vercel build.

## Local development

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

The development command starts Hono through its official Node.js adapter with watch mode. By default it listens on `http://localhost:3000`. The Vercel deployment continues to use the default Hono export from `src/index.ts`.

Useful validation commands:

```bash
pnpm test
pnpm typecheck
pnpm format:check
pnpm lint
pnpm build
pnpm build:smoke # Run after pnpm build
pnpm smoke:deployment -- https://your-preview.vercel.app
pnpm check
```

Pull requests and pushes to `main` run the same `pnpm check` pipeline in GitHub Actions.

## Environment variables

| Variable          | Required | Purpose                                                                         |
| ----------------- | -------- | ------------------------------------------------------------------------------- |
| `GITHUB_TOKEN`    | No       | Raises GitHub API rate limits. Sent only to `api.github.com` as a bearer token. |
| `PUBLIC_BASE_URL` | No       | Canonical public origin used in generated feed URLs.                            |

Never commit `.env` or `.env.local`. Feedlane does not include tokens, upstream response bodies, sensitive headers, stack traces, or internal paths in production error responses.

## GitHub Releases route

```text
GET /github/releases/:owner/:repo
```

The route reads the latest 30 releases from GitHub's public Releases API. Drafts are excluded. Prereleases remain in the feed and carry a `prerelease` category/tag. The release body is emitted as escaped HTML content, and each release HTML URL is used as its stable item ID.

Examples:

```bash
# RSS 2.0 (default)
curl 'http://localhost:3000/github/releases/honojs/hono'

# Atom 1.0
curl 'http://localhost:3000/github/releases/honojs/hono?format=atom'

# JSON Feed 1.0
curl 'http://localhost:3000/github/releases/honojs/hono?format=json'
```

Successful feeds use browser caching for 60 seconds and Vercel CDN caching for 10 minutes, with a stale-while-revalidate window. Errors are marked `private, no-store`.
Feed responses include strong ETags. Feed readers can use `HEAD` to inspect feed metadata and `If-None-Match` to receive `304 Not Modified` when the serialized feed has not changed.

## GitHub Commits route

```text
GET /github/commits/:owner/:repo
```

The route reads the latest 30 commits on a public repository's default branch. The first line of the commit message becomes the item title, the complete message is emitted as escaped HTML content, and the GitHub commit URL is used as the stable item ID. Linked GitHub authors include their profile URL; commits without a linked account fall back to the Git author name.

Examples:

```bash
# RSS 2.0 (default)
curl 'http://localhost:3000/github/commits/honojs/hono'

# Atom 1.0
curl 'http://localhost:3000/github/commits/honojs/hono?format=atom'

# JSON Feed 1.0
curl 'http://localhost:3000/github/commits/honojs/hono?format=json'
```

GitHub commit feeds use browser caching for 60 seconds and Vercel CDN caching for 5 minutes.

## Hacker News lists route

```text
GET /hackernews/:list
```

`list` must be one of:

- `news` for the front page.
- `newest` for the newest submissions.
- `best` for the most-upvoted stories from the last 48 hours.

This is Feedlane's first HTML-backed route. It fetches only `news.ycombinator.com`, requires an HTML response, and parses story rows with Cheerio. Each Hacker News discussion URL is the stable item ID. External story URLs are accepted only when they use HTTP or HTTPS; invalid link schemes fall back to the discussion URL. Page changes that leave no valid stories produce a sanitized upstream error instead of an empty feed.

Examples:

```bash
curl 'http://localhost:3000/hackernews/news'
curl 'http://localhost:3000/hackernews/newest?format=atom'
curl 'http://localhost:3000/hackernews/best?format=json'
```

Hacker News feeds use browser caching for 60 seconds and Vercel CDN caching for 5 minutes.

## Adding a route

1. Create a focused module under `src/routes/<source>/`.
2. Define a Zod schema for path parameters.
3. Implement a `FeedRoute` whose handler returns a `FeedDocument`; use a route factory when it needs source-specific configuration.
4. Use `HttpFetcher.json` or `HttpFetcher.html` with an HTTPS URL and the route's explicit host allowlist.
5. Wrap the definition with `defineFeedRoute` and add it to `src/routes/index.ts`.
6. Add MSW-backed tests for conversion, validation, and upstream error behavior. Tests must not call the real upstream service.

The fetcher intentionally rejects plain HTTP, credentials in URLs, nonstandard ports, hosts outside the route allowlist, redirects, unexpected JSON/HTML content types, oversized bodies, and slow requests. HTML routes must validate their parsed structure and safely encode generated HTML content. Do not add a route that accepts an arbitrary target URL: that would turn Feedlane into an open proxy and create an SSRF boundary failure.

## Observability and health

Every request emits two single-line JSON events to the runtime log:

- `request.started` contains the request ID, method, pathname, and Vercel request ID when available.
- `request.completed` adds the matched route template, status, duration, and sanitized Feedlane error code.

Query strings, authorization headers, tokens, upstream response bodies, and exception messages are not logged. Metrics use matched route templates and status groups to keep label cardinality bounded. Logger failures are isolated from request handling.

Operational endpoints are public and explicitly marked `private, no-store`:

```text
GET /health/live   # process is running
GET /health/ready  # at least one feed route is registered
GET /metrics       # Prometheus text exposition
```

The readiness check deliberately does not call GitHub: an upstream outage must not make the Feedlane process itself unready. `/metrics` exposes request totals, latency histograms, sanitized error totals, and process start time. These metrics are scoped to one warm Serverless Function instance and reset on cold starts; use Vercel Runtime Logs or an observability drain for deployment-wide aggregation.

Local examples:

```bash
curl 'http://localhost:3000/health/live'
curl 'http://localhost:3000/health/ready'
curl 'http://localhost:3000/metrics'
```

## Deploying to Vercel

Feedlane uses Vercel's Hono framework detection and exports the app from `src/index.ts`. To deploy your own copy:

1. Import the repository into Vercel or link it with `vercel link`.
2. Add `GITHUB_TOKEN` in the project environment settings if desired.
3. Set `PUBLIC_BASE_URL` to the production origin when requests may arrive through another host.
4. Run `vercel deploy`, or let a connected Git provider create deployments.

Node.js 24 is selected through the `engines` field. Vercel detects and bundles the default Hono application export as a Vercel Function. Feedlane uses response headers for Vercel CDN caching; it does not use Runtime Cache, Redis, or Vercel Cron.

GitHub Actions validates the project but does not deploy it. Deployments remain user-triggered through Vercel or the connected Git provider. Successful GitHub deployment status events run a deployment smoke test against health, readiness, route discovery, and sanitized error handling. A daily scheduled run uses the `FEEDLANE_PRODUCTION_URL` repository variable to exercise the public production RSS, Atom, JSON Feed, ETag, conditional request, GitHub commit, and Hacker News paths. The same test can be started manually with a deployment URL. Add `--upstream` locally, or enable the workflow input, to run the full feed-reader compatibility checks:

```bash
pnpm smoke:deployment -- https://your-preview.vercel.app --upstream
```

For a protected preview, configure a GitHub Actions repository secret named `VERCEL_AUTOMATION_BYPASS_SECRET` with the project's Vercel Protection Bypass for Automation value. Also configure repository variables named `VERCEL_AUTOMATION_BYPASS_PROJECT_SLUG` and `VERCEL_AUTOMATION_BYPASS_TEAM_SLUG` with the Vercel project and team slugs. The smoke script sends the secret only when the HTTPS target hostname exactly matches Vercel's generated `<project>-<deployment-id>-<team>.vercel.app` form. Other targets fail closed without receiving the header, and the secret is never printed.

## Security boundaries and current limitations

- Upstream URLs are constructed by routes, restricted to HTTPS, and checked against a route-level hostname allowlist.
- Automatic redirects and arbitrary proxy targets are rejected.
- Fetches have a 10-second timeout and a 2 MiB response-body limit.
- Error status responses are classified without consuming their response bodies.
- GitHub 404, rate-limit, and other upstream failures map to sanitized API errors.
- The Hacker News HTML route rejects unsupported lists, unexpected media types, unsafe story-link schemes, and pages with no valid stories.
- Structured logs and metrics contain bounded route templates and sanitized error codes, not credentials or upstream payloads.
- Generated feed URLs contain only the selected feed format and use `PUBLIC_BASE_URL` when configured.
- There are no automatic retries for `429` or other explicit client errors.
- HTML parsing is limited to predefined routes with explicit upstream host allowlists; arbitrary page conversion is not supported.
- Puppeteer and other browser-driven routes are not supported.

## License

Feedlane is open-source software available under the [MIT License](./LICENSE).
