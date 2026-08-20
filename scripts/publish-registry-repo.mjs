// Publish a staged schema registry tree to the registry's own Pages repository.
//
// The registry is hosted in its own repository (not this one) so its GitHub
// Pages site can be bound to the schema.spctre.dev custom domain without
// touching the docs site. This script pushes the tree produced by
// stage-pages-artifact.mjs to that repository's Pages-served branch, replacing
// whatever is there, so the branch always mirrors the built tree exactly and
// can never serve stale bytes that no longer appear in the manifest.
//
// The target repository is parameterized, not compiled in: it is read from
// SCHEMA_REGISTRY_REPO (the workflow wires it to the SCHEMA_REGISTRY_REPO
// repository variable with a documented default). Write access comes from
// SCHEMA_REGISTRY_TOKEN, a fine-grained personal access token that an operator
// must provision. GITHUB_TOKEN cannot write to a different repository, so this
// script fails closed with a clear message if the token is absent.
//
// Publishing by pushing the built tree is chosen over repository_dispatch so
// that every publish is gated by the verification in stage-pages-artifact.mjs
// (digests, pathBase contract, immutable-overwrite probe) and so the target
// repository needs no workflow of its own — it is a passive Pages host.
//
// Environment:
//   SCHEMA_REGISTRY_REPO          "<owner>/<name>" of the registry repository,
//                                 or a local path for testing
//   SCHEMA_REGISTRY_TOKEN         fine-grained PAT with Contents read/write on
//                                 the registry repository (not needed for
//                                 local-path clones)
//   SCHEMA_REGISTRY_BRANCH        branch to publish to (default main)
//   SCHEMA_REGISTRY_STAGING_DIR   registry tree staged by stage-pages-artifact.mjs
//   SCHEMA_REGISTRY_SOURCE_REPO   "<owner>/<name>" this publish originates from
//                                 (default getspctre/spctre)
//   SCHEMA_REGISTRY_SOURCE_SHA    source commit this publish was built from
//   SCHEMA_REGISTRY_AUTHOR_NAME   commit author name (default spctre-registry-publisher)
//   SCHEMA_REGISTRY_AUTHOR_EMAIL  commit author email
//                                 (default spctre-registry-publisher@spctre.dev)

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { cp, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";

const env = process.env;

function fail(message) {
  console.error(`[publish-registry-repo] ${message}`);
  process.exit(1);
}

function log(message) {
  console.log(`[publish-registry-repo] ${message}`);
}

function runGit(args, context, cwd) {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    }).trim();
  } catch (error) {
    const detail = String(error.stderr || error.message || "").trim();
    fail(`${context}: ${detail || "git exited non-zero"}`);
  }
}

async function main() {
  const repo = (env.SCHEMA_REGISTRY_REPO || "").trim();
  if (!repo) {
    fail(
      "SCHEMA_REGISTRY_REPO is not set. The publishing workflow must resolve it from the " +
        "SCHEMA_REGISTRY_REPO repository variable; an operator must create the registry " +
        "repository and set that variable.",
    );
  }

  const token = (env.SCHEMA_REGISTRY_TOKEN || "").trim();
  const isLocal = repo.startsWith("/") || repo.startsWith("./") || repo.startsWith("../");
  if (!isLocal && !token) {
    fail(
      "SCHEMA_REGISTRY_TOKEN is not set. Publishing needs write access to another " +
        "repository, which GITHUB_TOKEN cannot grant. An operator must create a fine-grained " +
        "personal access token with Contents read/write on the registry repository and store " +
        "it as the SCHEMA_REGISTRY_TOKEN Actions secret. Failing closed rather than guessing.",
    );
  }

  const branch = (env.SCHEMA_REGISTRY_BRANCH || "main").trim();
  const staging = (env.SCHEMA_REGISTRY_STAGING_DIR || "").trim();
  if (!staging) {
    fail("SCHEMA_REGISTRY_STAGING_DIR is not set; nothing to publish");
  }
  if (!existsSync(staging)) {
    fail(`the staged registry tree does not exist at ${staging}`);
  }
  const stagedFiles = readdirSync(staging);
  if (stagedFiles.length === 0) {
    fail(`the staged registry tree at ${staging} is empty; refusing to publish an empty site`);
  }

  const sourceRepo = (env.SCHEMA_REGISTRY_SOURCE_REPO || "getspctre/spctre").trim();
  const sourceSha = (env.SCHEMA_REGISTRY_SOURCE_SHA || "unknown").slice(0, 12);
  const authorName = env.SCHEMA_REGISTRY_AUTHOR_NAME || "spctre-registry-publisher";
  const authorEmail = env.SCHEMA_REGISTRY_AUTHOR_EMAIL || "spctre-registry-publisher@spctre.dev";

  const cloneUrl = isLocal ? repo : `https://github.com/${repo}.git`;
  const authValue = `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString(
    "base64",
  )}`;

  const work = await mkdtemp(join(os.tmpdir(), "spctre-registry-repo-"));

  try {
    const cloneArgs = isLocal
      ? ["clone", "--quiet", cloneUrl, work]
      : [
          "-c",
          "credential.helper=",
          "-c",
          `http.extraheader=${authValue}`,
          "clone",
          "--quiet",
          cloneUrl,
          work,
        ];
    runGit(cloneArgs, "clone the registry repository", null);
    if (!isLocal) {
      runGit(["config", "http.extraheader", authValue], "configure registry auth", work);
      runGit(["config", "credential.helper", ""], "disable credential helpers", work);
    }

    const current = runGit(["branch", "--show-current"], "read the current branch", work);
    if (current !== branch) {
      const remoteHas = runGit(
        ["ls-remote", "--heads", "origin", `refs/heads/${branch}`],
        "inspect registry branches",
        work,
      ).trim();
      if (remoteHas) {
        runGit(["checkout", "--quiet", branch], `checkout registry branch ${branch}`, work);
      } else {
        runGit(["checkout", "--quiet", "-b", branch], `create registry branch ${branch}`, work);
      }
    }

    const tracked = runGit(["ls-files"], "list tracked files", work).trim();
    if (tracked) {
      runGit(["rm", "-r", "--quiet", "--ignore-unmatch", "."], "clear the registry branch", work);
    }

    for (const name of readdirSync(staging)) {
      await cp(join(staging, name), join(work, name), { recursive: true });
    }
    runGit(["add", "-A"], "stage registry files", work);

    const pending = runGit(["status", "--porcelain"], "read the working tree status", work).trim();
    if (!pending) {
      log(`registry tree is unchanged; ${repo}#${branch} already matches`);
      return;
    }

    runGit(["config", "user.name", authorName], "set the publisher identity", work);
    runGit(["config", "user.email", authorEmail], "set the publisher identity", work);
    runGit(
      ["commit", "--quiet", "-m", `Publish schema registry (${sourceRepo}@${sourceSha})`],
      "create the publish commit",
      work,
    );
    const newHead = runGit(["rev-parse", "HEAD"], "read the new head sha", work);
    runGit(["push", "--quiet", "origin", `HEAD:${branch}`], "push the registry tree", work);

    log(
      `published schema registry to ${repo}#${branch} at ${newHead} ` +
        `(${stagedFiles.length} top-level entries)`,
    );
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`[publish-registry-repo] unexpected failure: ${error.stack || error}`);
  process.exit(1);
});
