import { Octokit, RequestError } from 'octokit';
import { z } from 'zod';

export const MAX_FILES = 200;

export const MAX_REPOSITORY_FILE_BYTES = 1024 * 1024;

const MAX_INPUT_BYTES = 512 * 1024;

export class ReviewInputLimitError extends Error {}

const repositorySchema = z.object({
  owner: z.object({
    login: z.string().min(1),
  }),
  name: z.string().min(1),
});

const shaSchema = z.string().regex(/^[0-9a-f]{40}$/i);

const mergeBaseResponseSchema = z.object({
  merge_base_commit: z.object({ sha: shaSchema }),
});

const repositoryFileResponseSchema = z.object({
  type: z.literal('file'),
  encoding: z.literal('base64'),
  size: z.number().int().nonnegative().max(MAX_REPOSITORY_FILE_BYTES),
  content: z.string(),
});

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

export async function getMergeBaseSha({
  token,
  owner,
  repo,
  baseSha,
  headSha,
}: {
  token: string;
  owner: string;
  repo: string;
  baseSha: string;
  headSha: string;
}) {
  const octokit = new Octokit({
    auth: token,
    throttle: {
      onRateLimit: () => false,
      onSecondaryRateLimit: () => false,
    },
  });

  const response = await octokit.rest.repos.compareCommitsWithBasehead({
    owner,
    repo,
    basehead: `${baseSha}...${headSha}`,
    per_page: 1,
  });

  return mergeBaseResponseSchema.parse(response.data).merge_base_commit.sha;
}

export async function getRepositoryFileText({
  token,
  owner,
  repo,
  filePath,
  ref,
  signal,
}: {
  token: string;
  owner: string;
  repo: string;
  filePath: string;
  ref: string;
  signal?: AbortSignal;
}) {
  const segments = filePath.split('/');

  if (
    filePath.includes('\\') ||
    filePath.includes('\0') ||
    segments.some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    throw new Error('Use a file path relative to the repository root.');
  }

  if (!shaSchema.safeParse(ref).success) {
    throw new Error('A commit SHA is required to read a repository file.');
  }

  const octokit = new Octokit({
    auth: token,
    throttle: {
      onRateLimit: () => false,
      onSecondaryRateLimit: () => false,
    },
  });

  let responseData: unknown;

  try {
    const response = await octokit.rest.repos.getContent({
      owner,
      repo,
      path: filePath,
      ref,
      request: { signal },
    });

    responseData = response.data;
  } catch (error) {
    if (error instanceof RequestError && error.status === 404) {
      throw new Error('This file is missing or inaccessible at the requested commit.');
    }

    throw new Error('Could not read this file from GitHub at the requested commit.');
  }

  const file = repositoryFileResponseSchema.safeParse(responseData);

  if (!file.success) {
    throw new Error('GitHub did not return file contents. Request a single file up to 1 MiB.');
  }

  const bytes = Buffer.from(file.data.content, 'base64');

  if (bytes.length !== file.data.size) {
    throw new Error('GitHub returned incomplete file contents.');
  }

  let text: string;

  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new Error('The file is not valid UTF-8 text.');
  }

  if (text.includes('\0')) {
    throw new Error('The file contains binary data.');
  }

  return text;
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
