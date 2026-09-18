"use client";

import type { UiState } from "@webmcp-stack/codegen/dev";
import { useEffect, useRef } from "react";
import { CopyCommand } from "@/components/copy-command";
import { mountDashboard } from "@/lib/dashboard-mount";
import { DASHBOARD_STATE, DEMO_SOURCE } from "@/lib/demo-data";

/* The demo is the product: the real dashboard UI from
   packages/codegen/src/dev/ui.ts, mounted in a shadow root and booted from
   injected state (no server). Code disclosure lives inside the dashboard —
   each tool's detail reveals its generated source. */

export function DashboardDemo() {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    // The landing demo shows the local dashboard: no bridge, so its test
    // calls and edit hints read the way they do on the developer's machine.
    // The cast is for the generated literal in lib/demo-data.ts: its tool
    // shapes are inferred as a union, which no schema type can accept as-is.
    mountDashboard(host, DASHBOARD_STATE as unknown as UiState);
  }, []);

  return (
    <div className="overflow-hidden border border-line bg-panel">
      {/* The toolbar: what this is, where the tools came from, where it
          runs. On phones the provenance is the whole bar (the sidebar
          right below already says webmcpstack/codegen); the three-zone
          layout needs a desktop's width. */}
      <div className="relative flex items-center justify-center gap-3 border-b border-line bg-panel-raised/60 px-4 py-2.5 sm:justify-between">
        <span className="hidden font-mono text-[11px] text-ghost sm:inline">
          webmcp-codegen dev
        </span>
        <a
          href={DEMO_SOURCE.specUrl}
          target="_blank"
          rel="noreferrer"
          className="font-mono text-[11px] text-dim transition-colors hover:text-accent sm:absolute sm:left-1/2 sm:-translate-x-1/2"
        >
          generated from {DEMO_SOURCE.project}&apos;s OpenAPI spec <span aria-hidden="true">↗</span>
        </a>
        <span className="hidden font-mono text-[11px] text-faint sm:inline">localhost:4700</span>
      </div>

      {/* The dashboard fills the frame. Code is revealed per-tool, inside the
          dashboard, via the progressive-disclosure affordance on each tool. */}
      <div ref={hostRef} className="dashboard-demo-host h-[30rem] sm:h-[32rem]" />

      {/* The footer bar mirrors the chrome: the top names the object and its
          provenance, the bottom offers the command that recreates it. On
          phones the command stands alone; the quiet labels are desktop
          furniture. */}
      <div className="relative flex items-center justify-center border-t border-line bg-panel-raised/60 px-4 py-3">
        <span className="hidden font-mono text-[11px] text-ghost sm:inline">
          the built-in playground
        </span>
        <div className="sm:absolute sm:left-1/2 sm:-translate-x-1/2">
          <CopyCommand command="npx @webmcp-stack/codegen dev" bare />
        </div>
        <span className="hidden font-mono text-[11px] text-faint sm:ml-auto sm:inline">
          yours looks like this
        </span>
      </div>
    </div>
  );
}
