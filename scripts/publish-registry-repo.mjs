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
// Two guards run before any network or filesystem work, fail-closed and early:
//   - the target must be exactly "<owner>/<name>" (no protocol, no path, no
//     ".git" suffix, no whitespace); anything else is refused, and
//   - the target must not be the repository this workflow runs in
//     (SCHEMA_REGISTRY_REPO vs SCHEMA_REGISTRY_SOURCE_REPO / GITHUB_REPOSITORY),
//     so a misconfiguration can never replace-all publish over the source.
// Local paths are accepted as an explicit testing-only form.
//
// The generated tree owns every path except an explicit allowlist
// (README.md and LICENSE), which are preserved across publishes so the
// repository keeps its own documentation and licence; they are never deleted,
// overwritten, or swept into the publish commit.
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
  const rawRepo = env.SCHEMA_REGISTRY_REPO || "";
  const repo = rawRepo.trim();
  if (!repo) {
    fail(
      "SCHEMA_REGISTRY_REPO is not set. The publishing workflow must resolve it from the " +
        "SCHEMA_REGISTRY_REPO repository variable; the registry repository is " +
        "getspctre/schema. Refusing to guess a target repository.",
    );
  }

  const isLocal = repo.startsWith("/") || repo.startsWith("./") || repo.startsWith("../");
  const sourceRepo = (
    env.SCHEMA_REGISTRY_SOURCE_REPO ||
    env.GITHUB_REPOSITORY ||
    "getspctre/spctre"
  ).trim();
  if (!isLocal) {
    if (!/^[^\s/]+\/[^\s/]+$/.test(rawRepo)) {
      fail(
        `SCHEMA_REGISTRY_REPO must be exactly "<owner>/<name>" (no protocol, no path, no ` +
          `whitespace), got "${repo}"; refusing to guess a target repository`,
      );
    }
    if (rawRepo.endsWith(".git")) {
      fail(
        `SCHEMA_REGISTRY_REPO must not end in ".git", got "${repo}"; refusing to guess a ` +
          "target repository",
      );
    }
    if (repo.toLowerCase() === sourceRepo.toLowerCase()) {
      fail(
        `SCHEMA_REGISTRY_REPO (${repo}) resolves to the repository this workflow runs in ` +
          `(${sourceRepo}); refusing to replace-all publish over the source repository`,
      );
    }
  }

  const token = (env.SCHEMA_REGISTRY_TOKEN || "").trim();
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

    // Preserve the repository's own documentation and licence. The registry
    // tree is generated content, so it owns every other path, but a public
    // repository should keep its README and LICENSE intact across publishes.
    const preserved = ["README.md", "LICENSE"];

    const tracked = runGit(["ls-files"], "list tracked files", work).trim();
    const toRemove = tracked.split("\n").filter((file) => file && !preserved.includes(file));
    if (toRemove.length > 0) {
      runGit(
        ["rm", "-r", "--quiet", "--ignore-unmatch", ...toRemove],
        "clear the registry branch (preserving README.md and LICENSE)",
        work,
      );
    }

    for (const name of readdirSync(staging)) {
      await cp(join(staging, name), join(work, name), { recursive: true });
    }
    runGit(["add", "-A"], "stage registry files", work);
    // Keep preserved files out of the publish commit: they are not generated
    // by the registry, so operator edits to them must survive a publish
    // untouched (and must not be swept into the commit).
    const preservedTracked = runGit(
      ["ls-files", "--", ...preserved],
      "list preserved files",
      work,
    ).trim();
    if (preservedTracked) {
      runGit(
        ["reset", "--quiet", "--", ...preserved],
        "exclude preserved files from the publish commit",
        work,
      );
    }

    const pending = runGit(["diff", "--cached", "--name-only"], "read staged changes", work).trim();
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
