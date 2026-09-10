/**
 * CLI output rendering. The design goal: a summary you can scan in three
 * seconds, with the next step always visible. Every line must earn its place
 * and be understandable by someone who has never seen the tool before.
 */

import CFonts from "cfonts";
import Table from "cli-table3";
import pc from "picocolors";
import type { GenerateResult } from "./pipeline.js";
import type { Setup } from "./setup.js";
import type { WirePlan } from "./wire.js";

// picocolors auto-detects TTY and NO_COLOR, so piping to a file or CI logs
// gets plain text, not raw escape codes.
const c = {
  red: pc.red,
  green: pc.green,
  yellow: pc.yellow,
  blue: pc.blue,
  cyan: pc.cyan,
  gray: pc.gray,
};

const bold = pc.bold;
export const dim = pc.dim;

/** Terminal width for layout; a sane default when piped. */
function termWidth(): number {
  return process.stdout.columns ?? 100;
}

/**
 * The banner, printed once at the start of every command — a banner leads,
 * it never sits in the middle of a report. The full wordmark in cfonts
 * "tiny": solid block letters, small enough that webmcp-stack fits in 51
 * columns. The color is the site's accent (#58a6ff), on a real terminal
 * only; piped output stays plain.
 */
export function printBanner(): void {
  const isTTY = process.stdout.isTTY === true;
  const mark = CFonts.render("webmcp-stack", {
    font: "tiny",
    space: false,
    ...(isTTY ? { colors: ["#58a6ff"] } : {}),
  });
  console.log("");
  if (mark) {
    for (const line of mark.string.split("\n")) {
      if (line.trim().length > 0) console.log(line);
    }
  }
  console.log(dim("  codegen: tools AI agents can call, from the contract you already have"));
  console.log("");
}

/**
 * Group findings by what the person needs to do about them. A finding that
 * repeats 60 times ("this endpoint may return personal data") reads as one
 * line plus a list of names, not a 60-line wall. Order is fixed so the
 * output is stable run to run.
 */
export interface FindingGroup {
  key: "auth" | "admin" | "pii" | "postAsRead" | "other";
  /** One sentence naming the category and the recourse, with the count. */
  heading: string;
  /** Tool/route names affected. */
  items: string[];
}

export function groupFindings(findings: GenerateResult["findings"]): FindingGroup[] {
  // Headings are functions of the count: "1 auth endpoint disabled" and
  // "9 auth endpoints disabled" are both sentences a person would write.
  const groups: Record<
    Exclude<FindingGroup["key"], "other">,
    { heading: (n: number) => string; items: string[] }
  > = {
    auth: {
      heading: (n) =>
        `${n} auth endpoint${n === 1 ? "" : "s"} withheld; agents should never sign in`,
      items: [],
    },
    admin: {
      heading: (n) => `${n} admin endpoint${n === 1 ? "" : "s"} withheld; review before enabling`,
      items: [],
    },
    pii: {
      heading: (n) =>
        `${n} endpoint${n === 1 ? "" : "s"} may return personal data; check each response`,
      items: [],
    },
    postAsRead: {
      heading: (n) =>
        `${n} POST endpoint${n === 1 ? "" : "s"} treated as read-only; verify that is correct`,
      items: [],
    },
  };
  // Anything outside the four known categories is grouped by its message, so
  // 48 copies of the same note collapse into one heading plus a name list.
  const othersByMessage = new Map<string, string[]>();

  for (const f of findings) {
    if (f.level === "error") continue; // errors print on their own, in red
    const msg = f.message.toLowerCase();
    const name = f.tool ?? "";
    if (msg.includes("sign-in") || msg.includes("auth") || msg.includes("session")) {
      groups.auth.items.push(name);
    } else if (msg.includes("admin")) {
      groups.admin.items.push(name);
    } else if (msg.includes("pii") || msg.includes("email") || msg.includes("personal")) {
      groups.pii.items.push(name);
    } else if (msg.includes("post") && msg.includes("read")) {
      groups.postAsRead.items.push(name);
    } else {
      const list = othersByMessage.get(f.message) ?? [];
      list.push(name);
      othersByMessage.set(f.message, list);
    }
  }

  const order: Exclude<FindingGroup["key"], "other">[] = ["auth", "admin", "pii", "postAsRead"];
  const known = order
    .filter((key) => groups[key].items.length > 0)
    .map((key) => {
      const { heading, items } = groups[key];
      return { key, heading: heading(items.length), items };
    });
  const others = [...othersByMessage.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([message, items]) => ({
      key: "other" as const,
      heading: items.length > 1 ? `${items.length} tools: ${message}` : message,
      items,
    }));
  return [...known, ...others];
}

/** Comma-joined names wrapped to the terminal, with a hanging indent. */
function wrapNames(names: string[], indent: string): string[] {
  const width = Math.max(40, termWidth() - indent.length - 2);
  const lines: string[] = [];
  let line = indent;
  for (const name of names) {
    const piece = line === indent ? name : `, ${name}`;
    if (line.length + piece.length > width && line !== indent) {
      lines.push(line);
      line = indent + name;
    } else {
      line += piece;
    }
  }
  if (line !== indent) lines.push(line);
  return lines;
}

/** The default summary output — written for humans, not machines. */
export function renderSummary(
  result: GenerateResult,
  setup: Setup,
  _cwd: string,
  wiring?: WirePlan | null,
): void {
  const { tools, findings, skipped } = result;
  const enabled = tools.filter((t) => t.enabledByDefault).length;
  const withheld = tools.filter((t) => t.withheld && !t.enabledByDefault).length;
  const gated = tools.length - enabled - withheld;
  const groups = groupFindings(findings);

  // Header: the banner already led the command; here just the source.
  console.log(dim(`  ${setup.label}`));
  console.log("");

  // What happened
  console.log(`  ${c.green("✓")} ${bold(`${tools.length} tools generated`)}`);
  const parts = [`${enabled} ready to use`];
  if (withheld > 0) parts.push(`${withheld} withheld until you enable them`);
  if (gated > 0) parts.push(`${gated} visible but disabled`);
  console.log(dim(`    ${parts.join(", ")}`));
  if (skipped.length > 0) {
    console.log(dim(`    ${skipped.length} skipped (webhooks and excluded endpoints)`));
  }
  console.log("");

  // Blocking errors first, one line each, in red. They stop the write, and a
  // red wall that says exactly what to fix beats a green ✓ that doesn't mean it.
  const errorFindings = findings.filter((f) => f.level === "error");
  if (errorFindings.length > 0) {
    console.log(
      `  ${c.red("✖")} ${bold(`${errorFindings.length} error${errorFindings.length === 1 ? "" : "s"}, nothing written`)}`,
    );
    for (const f of errorFindings) {
      const where = f.tool ? dim(` (${f.tool})`) : "";
      console.log(`  ${c.red("✖")} ${f.message}${where}`);
    }
    console.log("");
  }

  // Safety notes: one line per category, not one per occurrence. Long
  // messages are trimmed here; --verbose shows them in full with the tools.
  const warnings = groups.reduce((sum, group) => sum + group.items.length, 0);
  if (warnings > 0) {
    console.log(
      `  ${c.yellow("!")} ${bold(`${warnings} safety note${warnings === 1 ? "" : "s"}`)}`,
    );
    const maxHeading = Math.max(60, termWidth() - 6);
    for (const group of groups) {
      const heading =
        group.heading.length > maxHeading
          ? `${group.heading.slice(0, maxHeading - 1)}…`
          : group.heading;
      console.log(dim(`    ${heading}`));
    }
    console.log(dim(`    Run with --verbose to see which tools`));
    console.log("");
  }

  // Where things went
  const outDir = setup.config.outputs[0]?.outDir ?? "src/webmcp";
  console.log(`  ${c.cyan("→")} ${bold("Files")} ${outDir}`);
  if (wiring && !wiring.alreadyWired) {
    console.log(`  ${c.cyan("→")} ${bold("Registration")} wired into your app`);
  }
  // Per-file notes (kept attributes, added names, unmatched controls). Capped
  // in the summary; --verbose lists them all.
  const fileNotes = result.files.flatMap((file) => file.notes ?? []);
  for (const note of fileNotes.slice(0, 6)) {
    console.log(dim(`    ${note}`));
  }
  if (fileNotes.length > 6) {
    console.log(dim(`    …and ${fileNotes.length - 6} more (run with --verbose)`));
  }

  // Pipeline proposals (groupings, renames): the run's "look at this" lines.
  for (const note of result.notes.slice(0, 6)) {
    console.log(`  ${c.cyan("◦")} ${note}`);
  }
  if (result.notes.length > 6) {
    console.log(dim(`    …and ${result.notes.length - 6} more (run with --verbose)`));
  }
  console.log("");

  // LLM proposals: visually distinct from findings (◦, cyan), because a
  // suggestion is not a fact. Nothing here was applied to anything.
  if (result.suggestions.length > 0) {
    console.log(
      `  ${c.cyan("◦")} ${bold(`${result.suggestions.length} LLM suggestion${result.suggestions.length === 1 ? "" : "s"}`)} ${dim("(proposals only; nothing applied)")}`,
    );
    for (const suggestion of result.suggestions) {
      console.log(dim(`    ◦ ${suggestion.message}`));
    }
    console.log("");
  }

  // Next step
  console.log(`  ${bold("Next:")} ${c.cyan("npx @webmcp-stack/codegen dev")}`);
  console.log(dim("  Review your tools, edit descriptions, test them live"));
  console.log("");
  console.log(dim(`  Docs: https://webmcp-stack.vercel.app/docs`));
  console.log("");
}

/** Verbose output — every tool, for when you want the full list. */
export function renderVerbose(result: GenerateResult, setup: Setup, _cwd: string): void {
  const { tools, findings, skipped } = result;

  console.log(dim(`${tools.length} tools from ${setup.label}`));
  console.log("");

  // Skipped first
  if (skipped.length > 0) {
    console.log(c.gray("Skipped:"));
    for (const s of skipped) {
      console.log(`  ${dim(s.ref)}`);
      console.log(`    ${dim(s.reason)}`);
    }
    console.log("");
  }

  // Tools grouped by risk, one table per group. Column widths adapt to the
  // terminal: the description column takes what is left and truncates, so the
  // box never breaks at the terminal's right edge.
  const byRisk = {
    read: tools.filter((t) => t.sideEffect === "read"),
    write: tools.filter((t) => t.sideEffect === "write"),
    destructive: tools.filter((t) => t.sideEffect === "destructive"),
  };

  const riskLabels: Record<string, string> = {
    read: c.green("Read-only"),
    write: c.yellow("Write"),
    destructive: c.red("Destructive"),
  };

  const width = termWidth();
  const nameWidth = Math.min(
    Math.max(...tools.map((t) => t.name.length), 4),
    Math.floor(width * 0.4),
  );
  const statusWidth = 10;
  // 4 border columns + padding between the three columns.
  const descWidth = Math.max(24, width - nameWidth - statusWidth - 10);

  for (const [risk, group] of Object.entries(byRisk)) {
    if (group.length === 0) continue;
    console.log(`${riskLabels[risk] ?? risk} ${dim(`(${group.length})`)}`);
    const table = new Table({
      head: [dim("Tool"), dim("Status"), dim("Description")],
      style: { head: [], border: [] },
      colWidths: [nameWidth + 2, statusWidth, descWidth],
      wordWrap: false,
    });
    for (const tool of group) {
      const description = tool.description || "(no description)";
      table.push([
        tool.name.length > nameWidth ? `${tool.name.slice(0, nameWidth - 1)}…` : tool.name,
        tool.enabledByDefault
          ? c.green("enabled")
          : tool.withheld
            ? dim("withheld")
            : dim("disabled"),
        description.length > descWidth - 2
          ? `${description.slice(0, descWidth - 3)}…`
          : description,
      ]);
    }
    console.log(table.toString());
    console.log("");
  }

  // Safety notes: grouped by what the person should do, with the affected
  // tools listed compactly under each. 60 identical ⚠ lines teach nothing;
  // 5 headed groups do.
  const errorFindings = findings.filter((f) => f.level === "error");
  const groups = groupFindings(findings);
  if (errorFindings.length > 0 || groups.length > 0) {
    console.log(bold("Safety notes"));
    console.log("");
    for (const f of errorFindings) {
      const where = f.tool ? dim(` (${f.tool})`) : "";
      console.log(`  ${c.red("✖")} ${f.message}${where}`);
    }
    if (errorFindings.length > 0) console.log("");
    for (const group of groups) {
      console.log(`  ${c.yellow("⚠")} ${group.heading}`);
      for (const line of wrapNames(group.items, "      ")) {
        console.log(dim(line));
      }
      console.log("");
    }
  }

  // LLM proposals, visually distinct from findings.
  if (result.suggestions.length > 0) {
    console.log(bold("LLM suggestions (proposals only; nothing applied):"));
    for (const suggestion of result.suggestions) {
      console.log(`  ${c.cyan("◦")} ${dim(suggestion.message)}`);
    }
    console.log("");
  }

  const notes = result.files.flatMap((file) => file.notes ?? []);
  if (notes.length > 0) {
    console.log(bold("File notes:"));
    for (const note of notes) {
      console.log(`  ${dim(note)}`);
    }
    console.log("");
  }

  console.log(dim(`Files: ${setup.config.outputs[0]?.outDir ?? "src/webmcp"}`));
  console.log(dim(`Docs: https://webmcp-stack.vercel.app/docs`));
  console.log("");
}
