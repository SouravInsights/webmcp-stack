"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { mountDashboard } from "@/lib/dashboard-mount";
import {
  createPlaygroundBridge,
  EXAMPLES,
  generateTools,
  labelForUrl,
  loadSpecFromUrl,
  MAX_SPEC_CHARS,
  type PlaygroundResult,
  readSpecFile,
  withResolvedServers,
} from "@/lib/playground";

/**
 * The hosted playground.
 *
 * Two steps, in the order a developer would do them locally: give it a spec,
 * then play with the tools it found. Step two is the real dashboard, mounted
 * from the same UI the CLI serves, with its requests answered in the page.
 */

const BUTTON =
  "border border-line bg-panel-raised px-3 py-2 font-mono text-[12px] text-dim " +
  "transition-colors duration-150 hover:border-faint hover:text-ink disabled:cursor-not-allowed " +
  "disabled:opacity-50";

export function Playground() {
  const [spec, setSpec] = useState("");
  const [label, setLabel] = useState("spec");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PlaygroundResult | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);

  // Mount the dashboard whenever a run lands. mountDashboard replaces whatever
  // is in the shadow root, so a second spec renders into the same frame.
  useEffect(() => {
    const host = hostRef.current;
    if (!host || !result) return;
    mountDashboard(host, result.state, {
      mode: "playground",
      bridge: createPlaygroundBridge(result.state),
    });
  }, [result]);

  async function generate(nextSpec: string, nextLabel: string, specUrl: string | null = null) {
    setBusy(true);
    setError(null);
    try {
      const generated = await generateTools(nextSpec, nextLabel);
      setSpec(nextSpec);
      setLabel(nextLabel);
      // A spec loaded from a URL can resolve its own relative server URLs;
      // a pasted one cannot, and its run form asks for a base URL instead.
      setResult({ ...generated, state: withResolvedServers(generated.state, specUrl) });
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : String(thrown));
    } finally {
      setBusy(false);
    }
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!spec.trim()) return;
    void generate(spec, label);
  }

  async function loadUrl() {
    const target = url.trim();
    if (!target) return;
    setBusy(true);
    setError(null);
    try {
      const text = await loadSpecFromUrl(target);
      await generate(text, labelForUrl(target), target);
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : String(thrown));
      setBusy(false);
    }
  }

  async function loadFile(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const text = await readSpecFile(file);
      await generate(text, file.name);
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : String(thrown));
      setBusy(false);
    }
  }

  const state = result?.state;
  const withheld = state?.tools.filter((tool) => !tool.enabled).length ?? 0;
  const tooBig = spec.length > MAX_SPEC_CHARS;

  return (
    <section className="mx-auto w-full max-w-6xl flex-1 px-5 pb-20 pt-24 sm:px-6 sm:pt-28">
      <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-ghost">playground</p>
      <h1 className="mt-3 max-w-3xl font-display text-[clamp(1.9rem,4.6vw,3rem)] font-medium leading-[1.05] tracking-[-0.02em]">
        See what your API becomes.
      </h1>
      <p className="mt-5 max-w-2xl text-[15px] leading-relaxed text-dim">
        Paste an OpenAPI spec, upload a file, or point at a URL. The real codegen pipeline runs over
        it, the same one the CLI runs, and the tools it finds land below: grouped by risk, each with
        its generated source and a form that calls the endpoint. Generation happens in a temporary
        directory that is deleted before the page gets its answer. No account, no storage.
      </p>

      {/* Step one: the spec. Paste is the primary path; a file and a URL are
          the two shortcuts to it. */}
      <form onSubmit={submit} className="mt-10 border border-line bg-panel">
        <div className="flex items-center justify-between gap-4 border-b border-line px-4 py-2.5 font-mono text-[11px]">
          <span className="text-ghost">1. give it a spec</span>
          <span className={tooBig ? "text-fault" : "text-faint"}>
            {spec.length === 0 ? "nothing yet" : `${Math.round(spec.length / 1024)} KB`}
            {tooBig ? " (over the 2 MB limit)" : ""}
          </span>
        </div>

        <div className="p-4 sm:p-5">
          <textarea
            value={spec}
            onChange={(event) => {
              setSpec(event.target.value);
              setLabel("spec");
            }}
            rows={10}
            spellCheck={false}
            placeholder={
              "openapi: 3.0.3\ninfo:\n  title: Your API\npaths:\n  /things:\n    get:\n      summary: List things"
            }
            className="w-full resize-y border border-line bg-baseline p-3 font-mono text-[12.5px] leading-relaxed text-ink outline-none transition-colors placeholder:text-ghost focus:border-faint"
          />

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <label className={`${BUTTON} cursor-pointer`}>
              choose a file
              <input
                type="file"
                accept=".json,.yaml,.yml"
                className="hidden"
                onChange={(event) => void loadFile(event.target.files?.[0])}
              />
            </label>
            <span className="font-mono text-[11px] text-ghost">or read one from a URL</span>
            <input
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              spellCheck={false}
              placeholder="https://example.com/openapi.json"
              className="min-w-0 flex-1 border border-line bg-baseline px-3 py-2 font-mono text-[12.5px] text-ink outline-none transition-colors placeholder:text-ghost focus:border-faint"
            />
            <button
              type="button"
              onClick={() => void loadUrl()}
              disabled={busy || !url.trim()}
              className={BUTTON}
            >
              load
            </button>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-4">
            <span className="font-mono text-[11px] text-ghost">try</span>
            {EXAMPLES.map((example) => (
              <button
                key={example.label}
                type="button"
                disabled={busy}
                title={example.note}
                onClick={() => {
                  setUrl(example.url);
                  void loadSpecFromUrl(example.url)
                    .then((text) => generate(text, labelForUrl(example.url), example.url))
                    .catch((thrown: unknown) => {
                      setError(thrown instanceof Error ? thrown.message : String(thrown));
                      setBusy(false);
                    });
                }}
                className={BUTTON}
              >
                {example.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-line bg-panel-raised/60 px-4 py-3">
          <span className="font-mono text-[11px] text-faint">
            dry run: nothing is written, and the temp directory is removed
          </span>
          <button
            type="submit"
            disabled={busy || tooBig || !spec.trim()}
            className="border border-accent/40 bg-accent/10 px-4 py-2 font-mono text-[12px] text-accent transition-colors duration-150 hover:bg-accent/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "generating..." : "generate tools"}
          </button>
        </div>
      </form>

      {error ? (
        <div className="mt-5 border border-fault/40 bg-fault/[0.07] px-4 py-3">
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-fault">
            could not run
          </p>
          <p className="mt-2 text-[13.5px] leading-relaxed text-dim">{error}</p>
        </div>
      ) : null}

      {/* Step two: the tools, in the real dashboard. */}
      {state ? (
        <div className="mt-12">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
            <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-ghost">
              2. play with them
            </p>
            <button
              type="button"
              className="font-mono text-[12px] text-dim transition-colors hover:text-ink"
              onClick={() => setResult(null)}
            >
              load another spec
            </button>
          </div>

          {state.tools.length === 0 ? (
            <div className="mb-4 border border-line bg-panel px-4 py-3 text-[13.5px] leading-relaxed text-dim">
              Nothing to expose here: every endpoint in this spec was skipped.
              {state.skipped.length > 0 ? (
                <ul className="mt-2 space-y-1">
                  {state.skipped.map((skipped) => (
                    <li key={skipped.ref} className="font-mono text-[12px] text-faint">
                      {skipped.ref}: {skipped.reason}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          <div className="overflow-hidden border border-line bg-panel">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-panel-raised/60 px-4 py-2.5">
              <span className="font-mono text-[11px] text-dim">
                {label}, {state.tools.length} tool{state.tools.length === 1 ? "" : "s"}
                {withheld > 0 ? `, ${withheld} withheld from agents` : ""}
                {result.warnings > 0 ? `, ${result.warnings} warnings` : ""}
              </span>
              <span className="font-mono text-[11px] text-faint">
                {result.errors > 0
                  ? `${result.errors} audit errors would block generate in your repo`
                  : "the audit found nothing blocking"}
              </span>
            </div>

            <div ref={hostRef} className="h-[32rem] sm:h-[38rem]" />

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-panel-raised/60 px-4 py-3">
              <span className="font-mono text-[11px] text-faint">
                test calls leave from your browser, so the API must allow them (CORS)
              </span>
              <Link
                href="/docs/quickstart"
                className="font-mono text-[11px] text-dim transition-colors hover:text-accent"
              >
                run it in your repo →
              </Link>
            </div>
          </div>

          <p className="mt-4 text-[13px] leading-relaxed text-faint">
            Edits here live in this tab only. In your repo, the same edits are written to
            .webmcp-codegen.json and survive regeneration.
          </p>
        </div>
      ) : null}
    </section>
  );
}
