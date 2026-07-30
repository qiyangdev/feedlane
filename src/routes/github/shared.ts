import { z } from "zod";

export const githubRepositoryParameters = z.object({
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

export type GithubRepositoryParameters = z.infer<typeof githubRepositoryParameters>;

export const GITHUB_API_VERSION = "2026-03-10";
