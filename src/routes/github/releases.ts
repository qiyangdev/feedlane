import { z } from "zod";

import type { FeedItem } from "../../core/feed.js";
import { UpstreamResponseError } from "../../core/errors.js";
import { defineFeedRoute, type FeedRoute } from "../../core/route.js";

const parameters = z.object({
  owner: z
    .string()
    .min(1)
    .max(39)
    .regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/),
  repo: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[A-Za-z0-9_.-]+$/)
    .refine((value) => value !== "." && value !== ".."),
});

const githubRelease = z.object({
  id: z.number().int().nonnegative(),
  html_url: z.url(),
  tag_name: z.string(),
  name: z.string().nullable(),
  body: z.string().nullable(),
  draft: z.boolean(),
  prerelease: z.boolean(),
  created_at: z.iso.datetime(),
  published_at: z.iso.datetime().nullable(),
  updated_at: z.iso.datetime(),
  author: z.object({
    login: z.string(),
    html_url: z.url(),
  }),
});

const githubReleases = z.array(githubRelease);
type GithubReleaseParameters = z.infer<typeof parameters>;

const definition: FeedRoute<GithubReleaseParameters> = {
  path: "/github/releases/:owner/:repo",
  name: "GitHub releases",
  description: "Published releases for a public GitHub repository.",
  parameters,
  cacheTtl: 600,
  async handler({ params, requestUrl, fetcher, environment }) {
    const apiUrl = new URL(
      `https://api.github.com/repos/${encodeURIComponent(params.owner)}/${encodeURIComponent(params.repo)}/releases`,
    );
    apiUrl.searchParams.set("per_page", "30");

    const payload = await fetcher.json(apiUrl, {
      allowedHosts: ["api.github.com"],
      accept: "application/vnd.github+json",
      ...(environment.githubToken === undefined ? {} : { token: environment.githubToken }),
    });
    const parsed = githubReleases.safeParse(payload);
    if (!parsed.success) {
      throw new UpstreamResponseError("GitHub returned an unexpected releases response.");
    }

    const releases = parsed.data.filter((release) => !release.draft);
    const items = releases.map(toFeedItem);
    const repositoryUrl = `https://github.com/${params.owner}/${params.repo}`;
    const updatedAt = items.reduce<Date | undefined>((latest, item) => {
      if (item.updatedAt === undefined) return latest;
      return latest === undefined || item.updatedAt > latest ? item.updatedAt : latest;
    }, undefined);

    return {
      title: `${params.owner}/${params.repo} releases`,
      description: `Published GitHub releases for ${params.owner}/${params.repo}.`,
      homeUrl: `${repositoryUrl}/releases`,
      feedUrl: requestUrl.toString(),
      language: "en",
      ...(updatedAt === undefined ? {} : { updatedAt }),
      items,
    };
  },
};

export const githubReleasesRoute = defineFeedRoute(definition);

function toFeedItem(release: z.infer<typeof githubRelease>): FeedItem {
  const description = release.body ?? "";
  return {
    id: release.html_url,
    title: release.name?.trim() || release.tag_name,
    url: release.html_url,
    description,
    contentHtml: `<pre>${escapeHtml(description)}</pre>`,
    publishedAt: new Date(release.published_at ?? release.created_at),
    updatedAt: new Date(release.updated_at),
    authors: [{ name: release.author.login, url: release.author.html_url }],
    categories: [release.prerelease ? "prerelease" : "release", release.tag_name],
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
