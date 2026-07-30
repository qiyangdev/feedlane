# Contributing to Feedlane

Feedlane is an API-only, route-driven feed service. Community contributions are the primary way new content sources are added. Core maintainers focus on the shared route contract, security boundaries, serialization, caching, and operations.

## Before proposing a route

A route should solve a real subscription need that the upstream source does not already serve well. Prefer stable public APIs. HTML parsing is acceptable when there is no suitable API and the page structure can be validated reliably.

Open a Route proposal issue before investing in a route when any of these are unclear:

- Whether the upstream permits automated access.
- Whether an official RSS, Atom, or JSON Feed already covers the use case.
- Whether authentication, rate limits, or response size make the route unsuitable for a public service.
- Whether the route would require changes to `src/core`, the fetcher, or the deployment architecture.

Do not propose routes that accept an arbitrary upstream URL, proxy private data, require user credentials in the request URL, bypass access controls, or depend on a browser runtime.

## Development setup

Requirements and local commands are documented in [README.md](./README.md). Install dependencies and run the full quality gate before submitting a pull request:

```bash
pnpm install
pnpm check
```

## Create a route scaffold

Use lowercase kebab-case names:

```bash
pnpm route:new -- <source> <route-name>
```

For example:

```bash
pnpm route:new -- example release-notes
```

The command creates:

- `src/routes/example/release-notes.ts`
- `tests/example-release-notes.test.ts`

It refuses to overwrite existing files and prints the explicit import required for `src/routes/index.ts`. The generated route intentionally returns a placeholder upstream error. Replace every placeholder and complete the pending tests before registration.

Feedlane deliberately does not auto-discover route files. Every production route must remain visible in `src/routes/index.ts` so its configuration and security scope can be reviewed.

## Route implementation requirements

Each route must:

1. Define a stable, lowercase path under `src/routes/<source>/`.
2. Validate every path parameter with Zod before fetching upstream data.
3. Construct upstream URLs inside the route. Never accept an arbitrary target URL.
4. Use HTTPS and an explicit `allowedHosts` list with `HttpFetcher.json` or `HttpFetcher.html`.
5. Validate JSON payloads with Zod, or validate the expected structure of parsed HTML.
6. Return Feedlane's `FeedDocument` model rather than serializer-specific objects.
7. Use stable item IDs and valid HTTP item URLs.
8. Escape all untrusted text included in generated HTML with `escapeHtml`. For readable-page extraction, pass only already-fetched HTML to `extractReadableContent` and use its sanitized `contentHtml` output.
9. Choose a cache TTL appropriate to the upstream update frequency and rate limits.
10. Map unexpected upstream content to a sanitized Feedlane error without logging response bodies or credentials.

Routes that fetch item detail pages must also set an explicit item limit, concurrency limit, timeout, response-size budget, content-size budget, and partial-failure policy. Defuddle or any future content parser must not fetch URLs directly or enable third-party network fallbacks; `HttpFetcher` remains the only upstream network boundary.

Feed routes accept only one optional query parameter: `format=rss|atom|json`. Route-specific filters belong in validated path parameters unless the core request contract is deliberately extended in a separate proposal.

## Testing a route

Route tests use MSW and must not call a real upstream service. Use `createRouteTestApp` to run only the route under test:

```ts
const app = createRouteTestApp(exampleRoute);
const response = await app.request(
  "https://feedlane.test/example/release-notes/widget?format=json",
);
```

At minimum, tests must cover:

- Conversion of a representative upstream response.
- The route title, item IDs, links, dates, content, authors, and categories that matter to readers.
- HTML escaping when upstream text appears in `contentHtml`.
- Script removal, dangerous URL removal, link resolution, and size limits for extracted readable content.
- Detail-item limits, concurrency limits, and the documented partial-failure behavior.
- Invalid path parameters being rejected before an upstream request.
- Malformed or structurally unexpected upstream responses.
- Relevant upstream errors such as `404` and rate limiting.
- Source-specific authentication headers without exposing token values.

Prefer small inline fixtures. Large fixtures should contain only the fields needed to demonstrate the upstream contract.

## Documentation and registration

Before opening a pull request:

1. Import and add the route explicitly in `src/routes/index.ts`.
2. Document the route path, behavior, supported values, and RSS/Atom/JSON examples in `README.md`.
3. Confirm the root route catalogue includes the new route.
4. Remove scaffold placeholders and complete all route tests.
5. Run `pnpm check`.

Keep route pull requests focused. Changes to core contracts, generic fetch behavior, deployment configuration, or unrelated routes should normally be proposed separately.

## Pull requests

Describe the upstream source, why Feedlane adds value over any native feed, the public route path, cache policy, and validation performed. Complete the Route contribution checklist in the pull request template.

Maintainers may decline routes whose upstream is unstable, private, legally restricted, prohibitively expensive, already has a sufficient native feed, or cannot fit Feedlane's serverless and SSRF boundaries.
