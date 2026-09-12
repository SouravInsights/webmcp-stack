#!/usr/bin/env node
/**
 * The skill-file eval runner: prompt -> captured run -> checks -> score.
 *
 * Each case gets a fresh copy of fixture/ (plus the skill file, unless the
 * case removes it), an agent runs the case's prompt inside it headlessly,
 * and deterministic checks grade what the agent left behind - files, not
 * transcripts, wherever possible. Behavior is nondeterministic: run trials
 * and report pass RATES, never a single run's verdict.
 *
 * Usage:
 *   node run.mjs                      all cases, default trials
 *   node run.mjs --trials 5           more trials per case
 *   node run.mjs --case journey-document-trip
 *   node run.mjs --selftest           grade the graders (no agent needed)
 *
 * The agent command comes from AGENT_CMD, defaulting to cases.json's
 * `agent_cmd_default`; `{PROMPT}` is replaced by the shell-quoted prompt.
 * Examples:
 *   AGENT_CMD='codex exec --json "{PROMPT}"'
 *   AGENT_CMD='claude -p "{PROMPT}" --output-format json'
 */

import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(here, "fixture");
const GENERATED_END =
  "// --- webmcp-codegen: end generated. Your code below survives regeneration. ---";

// ---------------------------------------------------------------- graders
// Every grader: async (ctx) => null on pass, or a sentence on failure.
// ctx = { workdir, fixtureDir, transcript, check }

/** Read file list under a dir, recursively, relative paths sorted. */
async function tree(dir, base = dir) {
  let out = [];
  let entries = [];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out = out.concat(await tree(full, base));
    else out.push(relative(base, full));
  }
  return out.sort();
}

async function readIn(dir, rel) {
  try {
    return await readFile(join(dir, rel), "utf8");
  } catch {
    return null;
  }
}

const graders = {
  async "file-exists"({ workdir, check }) {
    return (await readIn(workdir, check.path)) === null ? `missing file: ${check.path}` : null;
  },

  async "file-matches"({ workdir, check }) {
    const contents = await readIn(workdir, check.path);
    if (contents === null) return `missing file: ${check.path}`;
    return matchFailures(contents, check);
  },

  async "any-file-matches"({ workdir, check }) {
    const files = (await tree(join(workdir, check.dir), join(workdir, check.dir))).filter((name) =>
      name.endsWith(".webmcp.ts"),
    );
    for (const name of files) {
      const contents = await readIn(join(workdir, check.dir), name);
      if (contents !== null && matchFailures(contents, check) === null) return null;
    }
    return `no file under ${check.dir}/ satisfied all patterns (checked ${files.length} file${files.length === 1 ? "" : "s"})`;
  },

  /** The generated region (start of file through the end marker) must be byte-identical to the fixture's. */
  async "marker-preserved"({ workdir, fixtureDir, check }) {
    const before = await readIn(fixtureDir, check.path);
    const after = await readIn(workdir, check.path);
    if (after === null) return `missing file: ${check.path}`;
    if (before === null) return `fixture has no ${check.path} to compare against`;
    const headOf = (text) => {
      const index = text.indexOf(GENERATED_END);
      return index === -1 ? text : text.slice(0, index + GENERATED_END.length);
    };
    return headOf(after) === headOf(before)
      ? null
      : `${check.path}: the generated region was edited - regeneration will clobber it; descriptions and names move through .webmcp-codegen.json`;
  },

  /** Nothing under src/webmcp may differ from the fixture (negative cases). */
  async "no-webmcp-diff"({ workdir, fixtureDir }) {
    const subdir = "src/webmcp";
    const beforeFiles = await tree(join(fixtureDir, subdir));
    const afterFiles = await tree(join(workdir, subdir));
    const changed = new Set();
    for (const name of new Set([...beforeFiles, ...afterFiles])) {
      const before = await readIn(join(fixtureDir, subdir), name);
      const after = await readIn(join(workdir, subdir), name);
      if (before !== after) changed.add(name);
    }
    return changed.size === 0
      ? null
      : `webmcp files changed on an unrelated prompt: ${[...changed].join(", ")}`;
  },

  /** Tool and parameter descriptions inside webmcp files stay within budget. */
  async "tool-description-budget"({ workdir, check }) {
    const files = (await tree(join(workdir, check.dir), join(workdir, check.dir))).filter((name) =>
      name.endsWith(".webmcp.ts"),
    );
    const offenders = [];
    for (const name of files) {
      const contents = await readIn(join(workdir, check.dir), name);
      if (contents === null) continue;
      const toolMatch = /description: "((?:[^"\\]|\\.)*)"/.exec(contents);
      if (toolMatch && (toolMatch[1] ?? "").length > check.max_tool) {
        offenders.push(`${name}: tool description ${(toolMatch[1] ?? "").length} chars`);
      }
      for (const match of contents.matchAll(
        /(?:properties|input):[\s\S]*?description: "((?:[^"\\]|\\.)*)"/g,
      )) {
        if ((match[1] ?? "").length > check.max_param) {
          offenders.push(`${name}: a parameter description runs ${(match[1] ?? "").length} chars`);
        }
      }
    }
    return offenders.length === 0 ? null : offenders.join("; ");
  },

  async "transcript-matches"({ transcript, check }) {
    return new RegExp(check.pattern, "i").test(transcript)
      ? null
      : `transcript never matched /${check.pattern}/`;
  },

  async "any-of"(ctx) {
    const failures = [];
    for (const inner of ctx.check.checks) {
      const failure = await graders[inner.type]({ ...ctx, check: inner });
      if (failure === null) return null;
      failures.push(failure);
    }
    return `none of the alternatives passed: ${failures.join(" | ")}`;
  },
};

function matchFailures(contents, check) {
  for (const pattern of check.all ?? []) {
    if (!new RegExp(pattern, "m").test(contents)) return `missing expected pattern: /${pattern}/`;
  }
  for (const pattern of check.none ?? []) {
    if (new RegExp(pattern, "m").test(contents)) return `matched forbidden pattern: /${pattern}/`;
  }
  return null;
}

// ------------------------------------------------------------------- runs

function shellQuote(text) {
  return `'${text.replaceAll("'", "'\\''")}'`;
}

function runAgent(command, prompt, workdir, timeoutMs) {
  const cmd = command.replace("{PROMPT}", shellQuote(prompt));
  return new Promise((resolveRun) => {
    const child = spawn(cmd, { cwd: workdir, shell: true, env: process.env });
    let out = "";
    child.stdout.on("data", (chunk) => (out += chunk));
    child.stderr.on("data", (chunk) => (out += chunk));
    const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolveRun({ code, transcript: out });
    });
  });
}

async function runCase(caseDef, command, trials, report) {
  const results = [];
  for (let trial = 0; trial < trials; trial++) {
    const workdir = await mkdtemp(join(tmpdir(), `webmcp-eval-${caseDef.id}-`));
    try {
      await cp(FIXTURE, workdir, { recursive: true });
      if (caseDef.skill === false)
        await rm(join(workdir, ".agents"), { recursive: true, force: true });
      const { transcript } = await runAgent(
        command,
        caseDef.prompt,
        workdir,
        Number(process.env.EVAL_TIMEOUT_MS ?? 10 * 60 * 1000),
      );
      const failures = [];
      for (const check of caseDef.checks) {
        const failure = await graders[check.type]({
          workdir,
          fixtureDir: FIXTURE,
          transcript,
          check,
        });
        if (failure !== null) failures.push(`[${check.type}] ${failure}`);
      }
      results.push({ trial, pass: failures.length === 0, failures });
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  }
  const passed = results.filter((r) => r.pass).length;
  const gate = caseDef.kind === "control" ? "informational" : passed === results.length;
  report.cases.push({
    id: caseDef.id,
    kind: caseDef.kind,
    passed,
    trials: results.length,
    gate,
    results,
  });
  console.log(
    `  ${gate === true ? "ok" : gate === "informational" ? "i" : "x"} ${caseDef.id}: ${passed}/${results.length} passed${caseDef.kind === "control" ? " (control)" : ""}`,
  );
  for (const result of results.filter((r) => !r.pass)) {
    for (const line of result.failures) console.log(`      trial ${result.trial + 1}: ${line}`);
  }
}

// -------------------------------------------------------------- self-test

async function selftest() {
  const workdir = await mkdtemp(join(tmpdir(), "webmcp-eval-selftest-"));
  try {
    await cp(FIXTURE, workdir, { recursive: true });

    const expectOutcome = async (label, check, expectFail, patch) => {
      const dir = await mkdtemp(join(tmpdir(), "webmcp-eval-selftest-case-"));
      await cp(FIXTURE, dir, { recursive: true });
      if (patch) await patch(dir);
      const failure = await graders[check.type]({
        workdir: dir,
        fixtureDir: FIXTURE,
        transcript: "",
        check,
      });
      const gotFail = failure !== null;
      console.log(
        `  ${gotFail === expectFail ? "ok" : "x"} ${label}${gotFail && expectFail ? ` (${failure})` : ""}`,
      );
      await rm(dir, { recursive: true, force: true });
      return gotFail === expectFail;
    };

    const outcomes = [];
    const record = async (...args) => outcomes.push(await expectOutcome(...args));

    await record(
      "marker-preserved: untouched file passes",
      { type: "marker-preserved", path: "src/webmcp/create-trip.webmcp.ts" },
      false,
    );
    await record(
      "marker-preserved: edited head fails",
      { type: "marker-preserved", path: "src/webmcp/create-trip.webmcp.ts" },
      true,
      async (dir) => {
        const path = join(dir, "src/webmcp/create-trip.webmcp.ts");
        await writeFile(
          path,
          (await readFile(path, "utf8")).replace("Create a new trip.", "HAND EDITED text."),
        );
      },
    );
    await record(
      "marker-preserved: edit below the marker passes",
      { type: "marker-preserved", path: "src/webmcp/create-trip.webmcp.ts" },
      false,
      async (dir) => {
        const path = join(dir, "src/webmcp/create-trip.webmcp.ts");
        await writeFile(path, `${await readFile(path, "utf8")}\n// user code below the marker\n`);
      },
    );
    await record("no-webmcp-diff: untouched passes", { type: "no-webmcp-diff" }, false);
    await record(
      "no-webmcp-diff: a new tool fails",
      { type: "no-webmcp-diff" },
      true,
      async (dir) => writeFile(join(dir, "src/webmcp/new-tool.webmcp.ts"), "export {};\n"),
    );
    await record(
      "any-file-matches: a pattern the factory satisfies passes",
      {
        type: "any-file-matches",
        dir: "src/webmcp",
        all: ["export function createJourney"],
        none: [],
      },
      false,
    );
    await record(
      "any-file-matches: an empty journeys dir fails",
      { type: "any-file-matches", dir: "src/webmcp/journeys", all: ["createJourney"], none: [] },
      true,
    );
    await record(
      "any-file-matches: forbidden pattern trips",
      { type: "any-file-matches", dir: "src/webmcp", all: ["createTrip"], none: ["placeId"] },
      true,
    );
    await record(
      "any-file-matches: clean file passes",
      { type: "any-file-matches", dir: "src/webmcp", all: ["createTrip"], none: [] },
      false,
    );
    await record(
      "tool-description-budget: fixture within budget passes",
      { type: "tool-description-budget", dir: "src/webmcp", max_tool: 500, max_param: 150 },
      false,
    );
    await record(
      "tool-description-budget: over-budget description fails",
      { type: "tool-description-budget", dir: "src/webmcp", max_tool: 500, max_param: 150 },
      true,
      async (dir) => {
        const path = join(dir, "src/webmcp/list-trips.webmcp.ts");
        await writeFile(
          path,
          (await readFile(path, "utf8")).replace(
            /description: "((?:[^"\\]|\\.)*)"/,
            `description: "Wordy. ${"Detail upon detail. ".repeat(40)}"`,
          ),
        );
      },
    );
    await record(
      "transcript-matches: hits and misses",
      { type: "transcript-matches", pattern: "no-such-phrase-in-empty-transcript" },
      true,
    );

    const ok = outcomes.every(Boolean);
    await rm(workdir, { recursive: true, force: true });
    console.log(ok ? "\n  Self-test passed." : "\n  Self-test FAILED.");
    return ok ? 0 : 1;
  } catch (error) {
    console.error(error);
    return 1;
  }
}

// -------------------------------------------------------------------- main

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--selftest")) process.exit(await selftest());

  const cases = JSON.parse(await readFile(join(here, "cases.json"), "utf8"));
  const command = process.env.AGENT_CMD ?? cases.agent_cmd_default;
  const trials = Number(args[args.indexOf("--trials") + 1]) || cases.trials_default || 3;
  const only = args.includes("--case") ? args[args.indexOf("--case") + 1] : undefined;

  const selected = cases.cases.filter((c) => !only || c.id === only);
  if (selected.length === 0) {
    console.error(`No case matching ${only}. Known: ${cases.cases.map((c) => c.id).join(", ")}`);
    process.exit(2);
  }

  console.log(`Running ${selected.length} case(s), ${trials} trial(s) each, via: ${command}\n`);
  const report = { at: new Date().toISOString(), command, trials, cases: [] };
  for (const caseDef of selected) await runCase(caseDef, command, trials, report);

  const outDir = join(here, "results");
  await mkdir(outDir, { recursive: true });
  const outPath = join(outDir, `${report.at.replaceAll(":", "-")}.json`);
  await writeFile(outPath, JSON.stringify(report, null, 2));

  const gated = report.cases.filter((c) => c.kind !== "control");
  const allPassed = gated.every((c) => c.gate === true);
  console.log(
    `\n  ${gated.filter((c) => c.gate === true).length}/${gated.length} gated cases fully passing - report: ${relative(process.cwd(), outPath)}`,
  );
  process.exit(allPassed ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
