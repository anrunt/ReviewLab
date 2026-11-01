import { parseArgs } from 'node:util';
import { RequestError } from 'octokit';
import { z } from 'zod';
import { getPullRequest, getPullRequestFiles, MAX_FILES, ReviewInputLimitError } from './github.js';
import { getAuthStatus, login, logout } from './auth.js';

let args: ReturnType<typeof parseArgs>;

try {
  args = parseArgs({
    allowPositionals: true,
    strict: true,
    options: {
      help: {
        type: 'boolean',
        short: 'h',
      },
    },
  });

} catch (error) {
  const message = error instanceof Error
    ? error.message
    : "Failed to parse command-line arguments.";

  console.error(`Error: ${message}`);
  console.error("Run pnpm dev --help for usage.");
  process.exit(1);
}

if (args.values.help) {
  console.log(`
      Usage: pnpm dev <command>
      Commands:
      review <PR_URL>  Fetch a GitHub pull request snapshot.
      auth login      Sign in to a model provider using OAuth.
      auth status     Show saved credential status for supported providers.
      auth logout <provider>  Remove local credentials for a supported provider.

      Options:
      -h, --help      Show this help message.

      Example:
      pnpm dev review https://github.com/octocat/hello-world/pull/123

      V1 does not publish anything to GitHub.`
  );
  process.exit(0);
}

const { positionals } = args;

if (positionals[0] === "auth") {
  if (positionals[1] === "login" || positionals[1] === "status") {
    if (positionals.length !== 2) {
      console.error(`Usage: pnpm dev auth ${positionals[1]}`);
      process.exit(1);
    }
  } else if (positionals[1] === "logout") {
    if (positionals.length !== 3 || !positionals[2].trim()) {
      console.error("Usage: pnpm dev auth logout <provider>");
      process.exit(1);
    }
  } else {
    console.error("Usage: pnpm dev auth login | auth status | auth logout <provider>");
    process.exit(1);
  }

  try {
    if (positionals[1] === "login") {
      const result = await login();
      if (result.status === "completed") {
        console.log(`Login completed for ${result.providerId}. Credentials saved in the application data directory.`);
        console.log("Model access has not been verified yet.");
      } else if (result.status === "unchanged") {
        console.log(`Login skipped for ${result.providerId}. Saved credentials have not been changed.`);
      }
    } else if (positionals[1] === "status") {
      const statuses = await getAuthStatus();
      if (statuses.length === 0) {
        console.log("No saved credentials for supported providers. Run pnpm dev auth login to sign in.");
      }
      for (const status of statuses) {
        console.log(`${status.name}: saved credentials (${status.credentialType})`);
      }
      console.log("Model access and credential validity have not been verified. Environment API keys are not included.");
    } else if (positionals[1] === "logout") {
      const providerId = positionals[2];
      const removed = await logout(providerId);
      if (removed) {
        console.log(`Local credentials removed for ${providerId}.`);
      } else {
        console.log(`No local credentials for ${providerId}. You are already logged out locally.`);
      }
      console.log("Provider-side authorization and environment API keys have not been revoked or removed.");
    }
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : "Authentication command failed.";
    console.error(`Error: ${message}`);
    process.exit(1);
  }

  process.exit(0);
}

if (positionals[0] !== "review") {
  console.error("Unknown or missing command. Run pnpm dev --help for usage.");
  process.exit(1);
}

if (positionals.length !== 2) {
  console.error("Usage: pnpm dev review <PR_URL>");
  process.exit(1);
}

const [, pr_url] = positionals;
const urlResult = z.url({ error: "Invalid URL." }).safeParse(pr_url);

if (!urlResult.success) {
  console.error(urlResult.error.issues[0]?.message ?? "Invalid URL.");
  process.exit(1);
}

const prUrl = new URL(urlResult.data);

if (prUrl.protocol !== "https:") {
  console.error("URL must use HTTPS.");
  process.exit(1);
}

if (prUrl.host !== "github.com") {
  console.error("URL must point to github.com without a non-standard port.");
  process.exit(1);
}

const pathError = "Expected a pull request URL in the format https://github.com/owner/repo/pull/number.";
const numberError = "Pull request number must be a positive safe integer.";

const prPathSchema = z.tuple([
  z.literal("", { error: pathError }),
  z.string({ error: pathError }).regex(/^[a-zA-Z0-9_-]+$/, { error: pathError }),
  z.string({ error: pathError }).regex(/^[a-zA-Z0-9_.-]+$/, { error: pathError }),
  z.literal("pull", { error: pathError }),
  z.string({ error: numberError })
    .regex(/^[0-9]+$/, { error: numberError })
    .transform((value) => Number(value))
    .refine((value) => Number.isSafeInteger(value) && value > 0, {
      error: numberError,
    }),
], { error: pathError });

const pathSegments = prUrl.pathname.split("/");

try {
  if (pathSegments[1] !== undefined) {
    pathSegments[1] = decodeURIComponent(pathSegments[1]);
  }
  if (pathSegments[2] !== undefined) {
    pathSegments[2] = decodeURIComponent(pathSegments[2]);
  }
} catch {
  console.error(pathError);
  process.exit(1);
}

const pathResult = prPathSchema.safeParse(pathSegments);

if (!pathResult.success) {
  console.error(pathResult.error.issues[0]?.message ?? pathError);
  process.exit(1);
}

const [, owner, repo, , prNumber] = pathResult.data;

const githubToken = process.env.GITHUB_TOKEN;

if (!githubToken || githubToken.trim().length === 0) {
  console.error("Missing GITHUB_TOKEN.");
  process.exit(1);
}

let pullRequest: Awaited<ReturnType<typeof getPullRequest>>;
let pullRequestAfter: Awaited<ReturnType<typeof getPullRequest>>;
let files: Awaited<ReturnType<typeof getPullRequestFiles>>;

try {
  pullRequest = await getPullRequest({
    token: githubToken,
    owner,
    repo,
    prNumber,
  });

  if (pullRequest.changed_files > MAX_FILES) {
    console.error(`Pull request exceeds the file limit: ${pullRequest.changed_files} files, maximum ${MAX_FILES}. Review aborted.`);
    process.exit(1);
  }

  files = await getPullRequestFiles({
    token: githubToken,
    owner,
    repo,
    pullRequest,
  });

  pullRequestAfter = await getPullRequest({
    token: githubToken,
    owner,
    repo,
    prNumber,
  });
} catch (error) {
  if (error instanceof RequestError) {
    const headers = error.response?.headers;
    const isRateLimit = error.status === 429 || (
      error.status === 403 && (
        headers?.['x-ratelimit-remaining'] === '0' ||
        headers?.['retry-after'] !== undefined ||
        error.message.toLowerCase().includes('rate limit')
      )
    );

    if (!error.response|| error.status === 0) {
      console.error("Failed to connect to GitHub. Check your connection and try again.");
    } else if (isRateLimit) {
      console.error("GitHub API rate limit exceeded. Try again later.");
    } else if (error.status === 401) {
      console.error("GitHub authentication failed. Check GITHUB_TOKEN.");
    } else if (error.status === 403) {
      console.error("GitHub denied access. Check token permissions and repository access.");
    } else if (error.status === 404) {
      console.error("Pull request not found or inaccessible. Check the URL and repository access.");
    } else if (error.status >= 500 && error.status <= 599) {
      console.error("GitHub API is temporarily unavailable. Try again later.");
    } else {
      console.error(`GitHub API request failed (HTTP ${error.status}).`);
    }
  } else if (error instanceof z.ZodError) {
    const invalidFields = error.issues.map((issue) => issue.path.join('.'));
    console.error(`Invalid pull request data received from GitHub. Check fields: ${invalidFields.join(', ')}.`);
  } else if (error instanceof ReviewInputLimitError) {
    console.error(error.message);
  } else {
    console.error("Failed to fetch pull request data.");
  }

  process.exit(1);
}

if (
  pullRequest.base.sha !== pullRequestAfter.base.sha ||
  pullRequest.head.sha !== pullRequestAfter.head.sha
) {
  console.error("Pull request changed while fetching data. Run review again.");
  process.exit(1);
}

if (files.length !== pullRequestAfter.changed_files) {
  console.error(`Incomplete pull request file list: expected ${pullRequestAfter.changed_files} files, received ${files.length}. Review aborted.`);
  if (pullRequestAfter.changed_files > 3000) {
    console.error("GitHub's pull request files endpoint returns at most 3000 files, even with pagination.");
  }
  process.exit(1);
}

const filesWithoutPatch = files.filter((file) => !file.patch?.trim());
const filesWithPatchCount = files.length - filesWithoutPatch.length;

if (filesWithPatchCount === 0) {
  console.error("No text patches are available for review. Review aborted.");
  process.exit(1);
}

if (filesWithoutPatch.length > 0) {
  console.warn(`Warning: Review input is partial: ${filesWithPatchCount} of ${files.length} files have non-empty text patches. The following files have no text patch and their changes cannot be analyzed from the fetched data:`);
  for (const file of filesWithoutPatch) {
    console.warn(`- ${file.filename}`);
  }
}


console.log(`Owner: ${owner}`);
console.log(`Repo: ${repo}`);
console.log(`PR Number: ${prNumber}`);
console.log("Pull request data fetched successfully:");
console.log(pullRequest);
console.log(files);
