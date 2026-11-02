import { Octokit } from 'octokit';
import { z } from 'zod';

export const MAX_FILES = 200;

const MAX_INPUT_BYTES = 512 * 1024;

export class ReviewInputLimitError extends Error {}

const repositorySchema = z.object({
  owner: z.object({
    login: z.string().min(1),
  }),
  name: z.string().min(1),
});

const shaSchema = z.string().regex(/^[0-9a-f]{40}$/i);

const pullRequestSchema = z.object({
  number: z.number().int().positive(),
  html_url: z.url(),
  title: z.string(),
  body: z.string().nullable(),
  base: z.object({
    sha: shaSchema,
    repo: repositorySchema,
  }),
  head: z.object({
    sha: shaSchema,
    repo: repositorySchema.nullable(),
  }),
  changed_files: z.number().int().nonnegative(),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
});

const pullRequestFileSchema = z.object({
  sha: shaSchema,
  filename: z.string().min(1),
  status: z.enum(['added', 'removed', 'modified', 'renamed', 'copied', 'changed', 'unchanged']),
  previous_filename: z.string().min(1).optional(),
  patch: z.string().optional(),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  changes: z.number().int().nonnegative(),
});

const pullRequestFilesSchema = z.array(pullRequestFileSchema);

export async function getPullRequest({
  token,
  owner,
  repo,
  prNumber,
}: {
  token: string;
  owner: string;
  repo: string;
  prNumber: number;
}) {
  const octokit = new Octokit({
    auth: token,
    throttle: {
      onRateLimit: () => false,
      onSecondaryRateLimit: () => false,
    },
  });

  const response = await octokit.rest.pulls.get({
    owner,
    repo,
    pull_number: prNumber,
  });

  return pullRequestSchema.parse(response.data);
}

export async function getPullRequestFiles({
  token,
  owner,
  repo,
  pullRequest,
}: {
  token: string;
  owner: string;
  repo: string;
  pullRequest: z.infer<typeof pullRequestSchema>;
}) {
  const octokit = new Octokit({
    auth: token,
    throttle: {
      onRateLimit: () => false,
      onSecondaryRateLimit: () => false,
    },
  });

  const files: z.infer<typeof pullRequestFileSchema>[] = [];
  const initialInputBytes = Buffer.byteLength(JSON.stringify({ pullRequest, files }), 'utf8');

  if (initialInputBytes > MAX_INPUT_BYTES) {
    throw new ReviewInputLimitError(`Review input exceeds the size limit: ${initialInputBytes} bytes, maximum ${MAX_INPUT_BYTES} bytes (512 KiB). Review aborted.`);
  }

  const pages = octokit.paginate.iterator(
    octokit.rest.pulls.listFiles,
    {
      per_page: 100,
      owner,
      repo,
      pull_number: pullRequest.number,
    },
  );

  for await (const page of pages) {
    const pageFiles = pullRequestFilesSchema.parse(page.data);
    const fileCount = files.length + pageFiles.length;

    if (fileCount > MAX_FILES) {
      throw new ReviewInputLimitError(`Pull request exceeds the file limit: ${fileCount} files received, maximum ${MAX_FILES}. Review aborted.`);
    }

    const inputBytes = Buffer.byteLength(JSON.stringify({
      pullRequest,
      files: [...files, ...pageFiles],
    }), 'utf8');

    if (inputBytes > MAX_INPUT_BYTES) {
      throw new ReviewInputLimitError(`Review input exceeds the size limit: ${inputBytes} bytes, maximum ${MAX_INPUT_BYTES} bytes (512 KiB). Review aborted.`);
    }

    files.push(...pageFiles);
  }

  return files;
}
