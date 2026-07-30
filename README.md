# Feedlane

Feedlane is a lightweight, route-driven content feed conversion service inspired by RSSHub. A route fetches a narrowly scoped public API or HTML page, converts the result into Feedlane's own domain model, and the shared serializer produces RSS 2.0, Atom 1.0, or JSON Feed 1.0.

This first release is a standalone TypeScript and Hono API for Vercel Functions. It intentionally has no frontend, database, queue, user system, or scheduled jobs.

## Architecture

The dependency flow is deliberately one-way:

```text
Hono application
  -> static route registry
    -> typed route handler
      -> FeedDocument
        -> feed serializer adapter
```

`src/core` owns the runtime-independent feed model, route contract, registry, HTTP fetcher, errors, and the only adapter that imports the `feed` package. Route handlers return `FeedDocument`; they never return third-party serializer objects. `src/app.ts` is the Hono composition root, while `src/index.ts` is the Vercel-compatible default export.

Routes are registered explicitly in `src/routes/index.ts`. There is no filesystem discovery, dynamic plugin loading, or build-time code generation.

## Requirements

- Node.js 24 LTS
- pnpm 11

The exact package-manager version is recorded in `package.json`, and dependency resolutions are locked in `pnpm-lock.yaml`.

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
pnpm check
```

## Environment variables

| Variable       | Required | Purpose                                                                         |
| -------------- | -------- | ------------------------------------------------------------------------------- |
| `GITHUB_TOKEN` | No       | Raises GitHub API rate limits. Sent only to `api.github.com` as a bearer token. |

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

Successful feeds use browser caching for 60 seconds and Vercel CDN caching for 10 minutes, with stale-while-revalidate and stale-if-error windows. Errors are marked `private, no-store`.

## Adding a route

1. Create a focused module under `src/routes/<source>/`.
2. Define a Zod schema for path parameters.
3. Implement a `FeedRoute` whose handler returns a `FeedDocument`.
4. Use `HttpFetcher` with an HTTPS URL and the route's explicit host allowlist.
5. Wrap the definition with `defineFeedRoute` and add it to `src/routes/index.ts`.
6. Add MSW-backed tests for conversion, validation, and upstream error behavior. Tests must not call the real upstream service.

The fetcher intentionally rejects plain HTTP, credentials in URLs, nonstandard ports, hosts outside the route allowlist, redirects, non-JSON success responses, oversized bodies, and slow requests. Do not add a route that accepts an arbitrary target URL: that would turn Feedlane into an open proxy and create an SSRF boundary failure.

## Deploying to Vercel

Feedlane uses Vercel's Hono framework detection and exports the app from `src/index.ts`. To deploy your own copy:

1. Import the repository into Vercel or link it with `vercel link`.
2. Add `GITHUB_TOKEN` in the project environment settings if desired.
3. Run `vercel deploy`, or let a connected Git provider create deployments.

Node.js 24 is selected through the `engines` field. Vercel detects and bundles the default Hono application export as a Vercel Function. Feedlane uses response headers for Vercel CDN caching; it does not use Runtime Cache, Redis, or Vercel Cron.

Deployments are user-triggered; the repository does not include an automatic deployment workflow.

## Security boundaries and current limitations

- Upstream URLs are constructed by routes, restricted to HTTPS, and checked against a route-level hostname allowlist.
- Automatic redirects and arbitrary proxy targets are rejected.
- Fetches have a 10-second timeout and a 2 MiB response-body limit.
- GitHub 404, rate-limit, and other upstream failures map to sanitized API errors.
- There are no automatic retries for `429` or other explicit client errors.
- HTML parsing support is available through Cheerio for future routes, but no HTML route ships yet.
- Puppeteer and other browser-driven routes are not supported.

## License

Feedlane is open-source software available under the [MIT License](./LICENSE).
