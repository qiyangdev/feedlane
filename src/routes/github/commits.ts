import { z } from "zod";

import type { FeedAuthor, FeedItem } from "../../core/feed.js";
import { UpstreamResponseError } from "../../core/errors.js";
import { escapeHtml } from "../../core/html.js";
import { defineFeedRoute, type FeedRoute } from "../../core/route.js";
import {
  GITHUB_API_VERSION,
  githubRepositoryParameters,
  type GithubRepositoryParameters,
} from "./shared.js";

const gitIdentity = z
  .object({
    name: z.string(),
    date: z.iso.datetime(),
  })
  .nullable();

const githubUser = z.object({
  login: z.string(),
  html_url: z.url(),
});

const githubCommit = z
  .object({
    sha: z.string().regex(/^[0-9a-f]{40,64}$/i),
    html_url: z.url(),
    commit: z.object({
      message: z.string(),
      author: gitIdentity,
      committer: gitIdentity,
    }),
    author: githubUser.nullable(),
  })
  .refine((value) => value.commit.author !== null || value.commit.committer !== null);

const githubCommits = z.array(githubCommit);

export interface GithubCommitsRouteOptions {
  token: string | undefined;
}

export function createGithubCommitsRoute(options: GithubCommitsRouteOptions) {
  const definition: FeedRoute<GithubRepositoryParameters> = {
    path: "/github/commits/:owner/:repo",
    name: "GitHub commits",
    description: "Recent commits on a public GitHub repository's default branch.",
    parameters: githubRepositoryParameters,
    cacheTtl: 300,
    async handler({ params, requestUrl, fetcher }) {
      const apiUrl = new URL(
        `https://api.github.com/repos/${encodeURIComponent(params.owner)}/${encodeURIComponent(params.repo)}/commits`,
      );
      apiUrl.searchParams.set("per_page", "30");

      const payload = await fetcher.json(apiUrl, {
        allowedHosts: ["api.github.com"],
        accept: "application/vnd.github+json",
        additionalHeaders: {
          "X-GitHub-Api-Version": GITHUB_API_VERSION,
        },
        ...(options.token === undefined ? {} : { token: options.token }),
      });
      const parsed = githubCommits.safeParse(payload);
      if (!parsed.success) {
        throw new UpstreamResponseError("GitHub returned an unexpected commits response.");
      }

      const items = parsed.data.map(toFeedItem);
      const repositoryUrl = `https://github.com/${params.owner}/${params.repo}`;
      const updatedAt = items.reduce<Date | undefined>((latest, item) => {
        return latest === undefined || item.publishedAt > latest ? item.publishedAt : latest;
      }, undefined);

      return {
        title: `${params.owner}/${params.repo} commits`,
        description: `Recent commits on the default branch of ${params.owner}/${params.repo}.`,
        homeUrl: `${repositoryUrl}/commits`,
        feedUrl: requestUrl.toString(),
        language: "en",
        ...(updatedAt === undefined ? {} : { updatedAt }),
        items,
      };
    },
  };

  return defineFeedRoute(definition);
}

function toFeedItem(commit: z.infer<typeof githubCommit>): FeedItem {
  const publishedAt = new Date(commit.commit.author?.date ?? commit.commit.committer!.date);
  const title = commit.commit.message.split(/\r?\n/, 1)[0]?.trim() || commit.sha.slice(0, 12);
  const author = toFeedAuthor(commit);

  return {
    id: commit.html_url,
    title,
    url: commit.html_url,
    description: commit.commit.message,
    contentHtml: `<pre>${escapeHtml(commit.commit.message)}</pre>`,
    publishedAt,
    updatedAt: publishedAt,
    ...(author === undefined ? {} : { authors: [author] }),
    categories: ["commit"],
  };
}

function toFeedAuthor(commit: z.infer<typeof githubCommit>): FeedAuthor | undefined {
  if (commit.author !== null) {
    return { name: commit.author.login, url: commit.author.html_url };
  }

  const name = commit.commit.author?.name ?? commit.commit.committer?.name;
  return name === undefined || name.trim() === "" ? undefined : { name };
}
