## What changed

<!-- Describe the behavior and scope of this pull request. -->

## Why

<!-- Explain the user or developer problem this solves. -->

## Validation

<!-- List the commands, tests, and Preview checks that were run. -->

## Route contribution checklist

Complete this section when adding or changing a route. Mark non-route items as not applicable.

- [ ] The upstream source and public route path are documented.
- [ ] The route provides value beyond an existing official feed.
- [ ] All path parameters and upstream responses are validated.
- [ ] Upstream requests use HTTPS and an explicit hostname allowlist.
- [ ] The route cannot proxy an arbitrary URL or expose credentials.
- [ ] Untrusted HTML content is escaped.
- [ ] Item IDs, links, and dates are stable and valid.
- [ ] Cache TTL and upstream rate limits were considered.
- [ ] Tests use MSW and make no real upstream requests.
- [ ] Invalid parameters and unexpected upstream responses are tested.
- [ ] The route is explicitly registered and documented.
- [ ] `pnpm check` passes.
