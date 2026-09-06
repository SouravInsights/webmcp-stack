/**
 * The dashboard's UI: a single HTML page with embedded CSS and JS.
 * Design goals: professional, scannable, no visual noise.
 *
 * Layout:
 *   - Left sidebar: search + tool list, grouped by risk
 *   - Right panel: tool detail with edit, toggle, and test sections
 *
 * No framework, no build step. Plain HTML/CSS/JS shipped as a string.
 */

interface UiTool {
  name: string;
  description: string;
  sideEffect: string;
  enabled: boolean;
  endpointRole: string;
  piiInOutput: string[];
  findings: { level: string; message: string }[];
  inputSchema?: Record<string, unknown>;
  serverUrl?: string;
  requiresAuth?: boolean;
  verb?: string;
  path?: string;
  /** Where this tool came from: the route, the schema, or both ("merged"). */
  provenance?: string;
  /** Present when the tool annotates a form instead of generating a file. */
  form?: { path: string };
  /** Per-field text the developer overrode, so the editor shows their words. */
  fieldOverrides?: Record<string, string>;
  /** The generated file, shown on demand. The dashboard is the disclosure. */
  source?: { fileName: string; code: string };
}

interface UiState {
  label: string;
  outDir?: string;
  tools: UiTool[];
  skipped: { ref: string; reason: string }[];
  notes: string[];
}

/**
 * The dashboard page. With no argument it boots by fetching /api/state
 * (the dev server path). Pass `embeddedState` and the page boots from it
 * instead, with no network: the site's landing demo mounts this exact UI
 * statically, so the demo can never drift from the product.
 */
export function dashboardHtml(embeddedState?: UiState, opts?: { scoped?: boolean }): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover" />
<title>webmcpstack / codegen</title>
<style>
  /* Narrow screens: master-detail navigation instead of a split pane.
     The list is the default screen; selecting a tool slides the detail
     pane over it, and a back button pops back. Applies to the real
     dashboard on a phone and the embedded demo alike. */
  @media (max-width: 640px) {
    .app { display: block; position: relative; }
    .sidebar { width: 100% !important; min-width: 0; max-width: none; border-right: 0; height: 100%; }
    .sidebar-resize { display: none; }
    .tool-list { flex: 1; overflow-y: auto; -webkit-overflow-scrolling: touch; }
    .main {
      position: absolute;
      inset: 0;
      transform: translateX(100%);
      transition: transform 0.28s cubic-bezier(0.32, 0.72, 0.24, 1);
      box-shadow: -12px 0 32px rgba(0, 0, 0, 0.45);
      overflow-y: auto;
      -webkit-overflow-scrolling: touch;
    }
    .app.detail-open .main { transform: translateX(0); }
    .main .placeholder { display: none; }
    /* The back control is a bare chevron — a tap target, not a button. It
       sits inline at the left of the title row, so no vertical space is
       spent on navigation. */
    .back-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: none;
      border: 0;
      padding: 6px;
      margin: 0 0 0 -6px;
      color: var(--faint);
      cursor: pointer;
      -webkit-tap-highlight-color: transparent;
      transition: color 0.15s;
    }
    .back-btn:active { color: var(--ink); }
    .back-btn svg { display: block; }
  }
  @media (min-width: 641px) { .back-btn { display: none; } }
  ${opts?.scoped ? ":root, :host" : ":root"} {
    --baseline: #0a0b0f;
    --surface: #10131a;
    --surface-raised: #161a23;
    --line: #1e2330;
    --line-subtle: #161a23;
    --ink: #e9ecf2;
    --dim: #9aa3b2;
    --faint: #5d6575;
    --ghost: #3b4150;
    --accent: #58a6ff;
    --accent-dim: rgba(88, 166, 255, 0.15);
    --signal: #e3b341;
    --signal-dim: rgba(227, 179, 65, 0.15);
    --fault: #f47067;
    --fault-dim: rgba(244, 112, 103, 0.15);
    --sans: ui-sans-serif, system-ui, -apple-system, sans-serif;
    --mono: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; }
  html { overflow: hidden; overscroll-behavior: none; }
  body {
    background: var(--baseline);
    color: var(--ink);
    font-family: var(--sans);
    font-size: 14px;
    -webkit-font-smoothing: antialiased;
    overflow: hidden;
  }
  ::selection { background: var(--accent); color: var(--baseline); }

  /* Layout */
  .app { display: flex; height: 100vh; height: 100dvh; }
  .sidebar {
    position: relative;
    width: 320px;
    min-width: 240px;
    max-width: 480px;
    flex-shrink: 0;
    border-right: 1px solid var(--line);
    display: flex;
    flex-direction: column;
    background: var(--surface);
  }
  /* The drag handle on the sidebar's right edge. Invisible until you
     hover near it, then a 2px accent line — the Vercel/Linear idiom. */
  .sidebar-resize {
    position: absolute;
    top: 0;
    right: -3px;
    width: 7px;
    height: 100%;
    cursor: col-resize;
    z-index: 20;
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
  }
  .sidebar-resize::after {
    content: "";
    position: absolute;
    top: 0;
    right: 2px;
    width: 2px;
    height: 100%;
    background: transparent;
    transition: background 0.15s;
  }
  .sidebar-resize:hover::after,
  body.resizing .sidebar-resize::after {
    background: var(--accent);
  }
  body.resizing { cursor: col-resize; user-select: none; -webkit-user-select: none; }
  .main {
    flex: 1;
    min-width: 0;
    overflow-y: auto;
    background: var(--baseline);
  }

  /* Sidebar header */
  .sidebar-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 18px 16px 14px;
    border-bottom: 1px solid var(--line-subtle);
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 10px;
    font-weight: 600;
    font-size: 15px;
    min-width: 0;
  }
  .brand-mark {
    width: 20px;
    height: 20px;
    flex-shrink: 0;
  }
  .brand-accent {
    color: var(--accent);
  }
  .brand-product {
    color: var(--faint);
    font-weight: 400;
  }

  /* Search */
  .search-wrap {
    position: relative;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 16px;
    border-bottom: 1px solid var(--line-subtle);
  }
  .search {
    flex: 1;
    min-width: 0;
    background: var(--surface-raised);
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 8px 12px 8px 32px;
    color: var(--ink);
    font-size: 13px;
    font-family: inherit;
    position: relative;
  }
  .search:focus {
    outline: none;
    border-color: var(--accent);
  }
  .search-icon {
    position: absolute;
    left: 28px;
    top: 50%;
    transform: translateY(-50%);
    color: var(--faint);
    pointer-events: none;
  }

  /* Tool list */
  .tool-list {
    flex: 1;
    overflow-y: auto;
    padding: 8px 0;
  }
  .tool-group {
    padding: 8px 16px 4px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--faint);
  }
  .tool {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 8px 16px;
    border: none;
    background: none;
    color: var(--ink);
    font-size: 13px;
    font-family: var(--mono);
    text-align: left;
    cursor: pointer;
    transition: background 0.1s;
  }
  /* The dot is a leading status marker that shares the 16px axis with the
     group labels; the name follows a fixed gap. One column, no drift. */
  .tool:hover { background: var(--surface-raised); }
  .tool[aria-selected="true"] {
    background: var(--accent-dim);
    border-right: 2px solid var(--accent);
  }
  .tool-indicator {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .tool-indicator.read { background: var(--accent); }
  .tool-indicator.write { background: var(--signal); }
  .tool-indicator.destructive { background: var(--fault); }
  .tool-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tool-badge {
    font-size: 10px;
    padding: 2px 6px;
    border-radius: 4px;
    background: var(--surface-raised);
    color: var(--dim);
    text-transform: uppercase;
    letter-spacing: 0.02em;
  }
  .tool-badge.disabled { color: var(--signal); }

  /* Main content */
  .detail {
    max-width: 640px;
    margin: 0 auto;
    padding: 32px 40px;
  }
  .detail[hidden], .placeholder[hidden] { display: none !important; }
  .placeholder {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: var(--faint);
    text-align: center;
    padding: 40px;
  }
  .placeholder-icon {
    width: 48px;
    height: 48px;
    border-radius: 12px;
    background: var(--surface-raised);
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 16px;
    color: var(--ghost);
  }
  .placeholder kbd {
    background: var(--surface-raised);
    padding: 2px 6px;
    border-radius: 4px;
    font-family: var(--mono);
    font-size: 12px;
  }

  /* Detail header */
  .detail-header {
    margin-bottom: 20px;
    padding-bottom: 16px;
    border-bottom: 1px solid var(--line-subtle);
  }
  /* One row: back chevron, then the name. No wasted rows. */
  .detail-toprow {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 8px;
  }
  .detail-crumb {
    font-size: 12px;
    color: var(--faint);
    margin-bottom: 8px;
    font-family: var(--mono);
  }
  .detail-title {
    font-size: 17px;
    font-weight: 600;
    margin: 0;
    font-family: var(--mono);
    word-break: break-word;
    line-height: 1.3;
  }
  .detail-route {
    font-family: var(--mono);
    font-size: 13px;
    color: var(--dim);
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .verb {
    font-weight: 600;
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 11px;
  }
  .verb.read { color: var(--accent); background: var(--accent-dim); }
  .verb.write { color: var(--signal); background: var(--signal-dim); }
  .verb.destructive { color: var(--fault); background: var(--fault-dim); }

  /* Badges */
  .badges {
    display: flex;
    gap: 8px;
    margin-top: 12px;
    flex-wrap: wrap;
  }
  .badge {
    font-size: 11px;
    padding: 3px 8px;
    border-radius: 4px;
    font-weight: 500;
  }
  .badge.read { color: var(--accent); background: var(--accent-dim); }
  .badge.write { color: var(--signal); background: var(--signal-dim); }
  .badge.destructive { color: var(--fault); background: var(--fault-dim); }
  .badge.disabled { color: var(--signal); background: var(--signal-dim); }
  .badge.auth { color: var(--fault); background: var(--fault-dim); }

  /* Sections */
  .section {
    margin-bottom: 28px;
  }

  /* The per-tool source disclosure: the generated file, revealed on demand.
     A quiet row that expands into the code — the dashboard is the disclosure,
     not a separate view. */
  .source-disclosure {
    margin-bottom: 28px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--surface);
    overflow: hidden;
  }
  .source-disclosure summary {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
    cursor: pointer;
    list-style: none;
    font-family: var(--mono);
    font-size: 12px;
    color: var(--dim);
    user-select: none;
    -webkit-user-select: none;
    transition: color 0.15s, background 0.15s;
  }
  .source-disclosure summary::-webkit-details-marker { display: none; }
  .source-disclosure summary:hover { color: var(--ink); background: var(--surface-raised); }
  .source-chevron {
    display: inline-flex;
    color: var(--faint);
    transition: transform 0.2s cubic-bezier(0.32, 0.72, 0.24, 1);
  }
  .source-disclosure[open] .source-chevron { transform: rotate(90deg); }
  .source-label { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .source-hint { font-size: 11px; color: var(--ghost); }
  .source-code {
    margin: 0;
    padding: 14px 16px;
    border-top: 1px solid var(--line);
    background: var(--baseline);
    font-family: var(--mono);
    font-size: 11.5px;
    line-height: 1.6;
    color: var(--dim);
    overflow-x: auto;
    max-height: 340px;
    overflow-y: auto;
  }
  .section-label {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--faint);
    margin-bottom: 10px;
  }

  /* Description edit */
  .description-edit {
    width: 100%;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 12px;
    color: var(--ink);
    font-size: 14px;
    font-family: inherit;
    line-height: 1.5;
    resize: vertical;
    min-height: 80px;
  }
  .description-edit:focus {
    outline: none;
    border-color: var(--accent);
  }
  .detail-provenance {
    color: var(--faint);
    font-size: 12.5px;
    margin-top: 6px;
    font-family: var(--mono, ui-monospace, monospace);
  }
  .edit-actions {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-top: 10px;
  }
  .btn {
    padding: 8px 16px;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s;
    border: 1px solid var(--line);
    background: var(--surface);
    color: var(--ink);
  }
  .btn:hover { background: var(--surface-raised); border-color: var(--ghost); }
  .btn-primary {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--baseline);
  }
  .btn-primary:hover { background: #4a95ee; border-color: #4a95ee; }
  .saved-indicator {
    font-size: 12px;
    color: var(--accent);
    opacity: 0;
    transition: opacity 0.2s;
  }
  .saved-indicator.show { opacity: 1; }
  .edit-hint {
    font-size: 12px;
    color: var(--faint);
    margin-top: 8px;
    line-height: 1.5;
  }

  /* Field descriptions: text-first rows, one inline editor at a time. Not a
     form: a wall of pre-filled inputs reads as a second copy of the test
     form, which is exactly the duplication this replaced. */
  .field-list {
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--surface);
    overflow: hidden;
  }
  .field-row {
    padding: 10px 14px;
    border-bottom: 1px solid var(--line-subtle);
  }
  .field-row:last-child { border-bottom: 0; }
  .field-row-head {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 2px;
  }
  .field-name {
    font-family: var(--mono);
    font-size: 12.5px;
    color: var(--dim);
  }
  .field-text {
    font-size: 13px;
    line-height: 1.5;
  }
  .field-empty { color: var(--faint); }
  .field-edit-btn {
    margin-left: auto;
    background: none;
    border: 0;
    color: var(--faint);
    font-size: 12px;
    font-family: inherit;
    cursor: pointer;
    padding: 2px 6px;
    border-radius: 4px;
  }
  .field-edit-btn:hover { color: var(--ink); background: var(--surface-raised); }
  .field-row .param-input { margin-top: 6px; }
  .field-row .edit-actions { margin-top: 8px; }
  .badge.override { color: var(--accent); background: var(--accent-dim); }

  /* Toggle */
  .toggle-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 14px;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 8px;
  }
  .switch {
    width: 40px;
    height: 22px;
    border-radius: 11px;
    background: var(--surface-raised);
    border: 1px solid var(--line);
    position: relative;
    cursor: pointer;
    transition: all 0.2s;
    flex-shrink: 0;
  }
  .switch::after {
    content: "";
    position: absolute;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: var(--dim);
    top: 2px;
    left: 2px;
    transition: all 0.2s;
  }
  .switch[aria-checked="true"] {
    background: var(--accent);
    border-color: var(--accent);
  }
  .switch[aria-checked="true"]::after {
    left: 20px;
    background: white;
  }
  .toggle-copy { font-size: 13px; line-height: 1.5; }
  .toggle-copy strong { display: block; margin-bottom: 2px; }

  /* Try it */
  .try-section {
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 8px;
    overflow: hidden;
  }
  .try-header {
    padding: 14px 16px;
    border-bottom: 1px solid var(--line-subtle);
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .try-header h3 {
    margin: 0;
    font-size: 13px;
    font-weight: 600;
  }
  .try-note {
    font-size: 11px;
    color: var(--faint);
  }
  .try-body { padding: 16px; }
  .auth-note {
    background: var(--signal-dim);
    border: 1px solid var(--signal);
    color: var(--signal);
    padding: 10px 12px;
    border-radius: 6px;
    font-size: 12px;
    margin-bottom: 14px;
    line-height: 1.5;
  }
  .base-url-input {
    width: 100%;
    background: var(--baseline);
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 8px 12px;
    color: var(--ink);
    font-size: 13px;
    font-family: var(--mono);
    margin-bottom: 14px;
  }
  .base-url-input:focus {
    outline: none;
    border-color: var(--accent);
  }
  .param-list { margin-bottom: 14px; }
  .param {
    margin-bottom: 12px;
  }
  .param-label {
    display: block;
    font-size: 12px;
    font-weight: 500;
    margin-bottom: 4px;
    color: var(--dim);
  }
  .param-label .req { color: var(--fault); }
  .param-hint {
    font-size: 11px;
    color: var(--faint);
    margin-top: 2px;
  }
  .param-input {
    width: 100%;
    background: var(--baseline);
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 8px 12px;
    color: var(--ink);
    font-size: 13px;
    font-family: var(--mono);
  }
  .param-input:focus {
    outline: none;
    border-color: var(--accent);
  }
  .run-btn {
    width: 100%;
    padding: 10px;
    background: var(--accent);
    border: none;
    border-radius: 6px;
    color: var(--baseline);
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s;
  }
  .run-btn:hover { background: #4a95ee; }
  .run-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .result {
    margin-top: 14px;
    padding: 12px;
    background: var(--baseline);
    border: 1px solid var(--line);
    border-radius: 6px;
    font-family: var(--mono);
    font-size: 12px;
    white-space: pre-wrap;
    word-break: break-all;
    max-height: 300px;
    overflow-y: auto;
  }
  .result.ok { border-color: var(--accent); }
  .result.err { border-color: var(--fault); }
  .empty-note {
    padding: 14px;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 8px;
    color: var(--faint);
    font-size: 13px;
    line-height: 1.5;
  }

  /* Findings */
  .findings {
    margin-bottom: 20px;
  }
  .finding {
    display: flex;
    gap: 8px;
    padding: 10px 12px;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 6px;
    margin-bottom: 8px;
    font-size: 13px;
    line-height: 1.5;
  }
  .finding.warning { border-left: 3px solid var(--signal); }
  .finding.error { border-left: 3px solid var(--fault); }
  .finding-icon { flex-shrink: 0; }

  /* Scrollbar */
  ::-webkit-scrollbar { width: 8px; height: 8px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: var(--line); border-radius: 4px; }
  ::-webkit-scrollbar-thumb:hover { background: var(--ghost); }

  /* Narrow-screen content density. This block comes after the base .detail
     so it actually wins on source order — an earlier media query lost to the
     desktop rule, which is why the padding never changed. */
  @media (max-width: 640px) {
    .detail { padding: 14px 16px; max-width: none; }
    .detail-header { margin-bottom: 16px; padding-bottom: 12px; }
    .section { margin-bottom: 20px; }
    .sidebar-header { padding: 14px 16px 10px; }
  }
  ${
    opts?.scoped
      ? `
  /* Scoped mode: mounted inside a shadow root on the marketing site, where
     document-level selectors never match and vh/dvh would measure the page
     viewport, not the host — which is exactly what clipped the demo's scroll
     region before. This block comes LAST so it overrides the base rules:
     :host plays the body role and the app fills it, not the viewport. */
  :host {
    display: block;
    height: 100%;
    overflow: hidden;
    background: var(--baseline);
    color: var(--ink);
    font-family: var(--sans);
    font-size: 14px;
    -webkit-font-smoothing: antialiased;
  }
  .app {
    height: 100%;
    position: relative;
    overflow: hidden;
  }
  /* The demo's default sidebar width — narrower than the real dashboard's
     320px, so the detail pane gets the room in the embedded frame. The drag
     handle sets an inline width, which still wins over this; the mobile
     full-width sidebar rule carries !important and is unaffected. */
  .sidebar { width: 264px; }
  `
      : ""
  }
</style>
</head>
<body>
<div class="app">
  <aside class="sidebar">
    <div class="sidebar-header">
      <div class="brand">
        <svg class="brand-mark" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M12 2.5 L21 7 L12 11.5 L3 7 Z" fill="var(--accent)"></path>
          <path d="M3 12 L12 16.5 L21 12" stroke="currentColor" stroke-width="2" stroke-linejoin="round"></path>
          <path d="M3 16.5 L12 21 L21 16.5" stroke="currentColor" stroke-width="2" stroke-linejoin="round"></path>
        </svg>
        <span>webmcp<span class="brand-accent">stack</span><span class="brand-product"> / codegen</span></span>
      </div>
    </div>
    <div class="search-wrap">
      <svg class="search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="11" cy="11" r="8"></circle>
        <path d="m21 21-4.35-4.35"></path>
      </svg>
      <input type="text" class="search" id="search" placeholder="Search tools" spellcheck="false" />
    </div>
    <div class="tool-list" id="tool-list"></div>
    <div class="sidebar-resize" id="sidebar-resize" title="Drag to resize · double-click to reset"></div>
  </aside>
  <main class="main" id="main">
    <div class="placeholder" id="placeholder">
      <div class="placeholder-icon">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
        </svg>
      </div>
      <p>Select a tool to view details</p>
      <p style="font-size: 12px; margin-top: 8px;">
        <kbd>↑</kbd> <kbd>↓</kbd> to navigate &nbsp;·&nbsp; <kbd>⌘K</kbd> to search
      </p>
    </div>
    <div class="detail" id="detail" hidden></div>
  </main>
</div>

<script>
var EMBEDDED_STATE = ${embeddedState ? JSON.stringify(embeddedState) : "null"};
(function () {
  var state = null;
  var selected = null;
  var filter = "";
  var editingField = null;

  var listEl = document.getElementById("tool-list");
  var detailEl = document.getElementById("detail");
  var placeholderEl = document.getElementById("placeholder");
  var searchEl = document.getElementById("search");
  var appEl = document.querySelector(".app");

  function esc(text) {
    var div = document.createElement("div");
    div.textContent = text == null ? "" : String(text);
    return div.innerHTML;
  }

  function api(path, options) {
    return fetch(path, options).then(function (res) {
      if (!res.ok) throw new Error("Request failed: " + res.status);
      return res.json();
    });
  }

  function load() {
    if (EMBEDDED_STATE) {
      state = EMBEDDED_STATE;
      renderList();
      renderDetail();
      return;
    }
    api("/api/state").then(function (data) {
      state = data;
      renderList();
      renderDetail();
    }).catch(function (error) {
      console.error("Failed to load tools:", error);
      listEl.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--fault);">Error loading tools: ' + esc(error.message) + '</div>';
    });
  }

  function visibleTools() {
    if (!state) return [];
    var f = filter.toLowerCase();
    return state.tools.filter(function (tool) {
      return tool.name.toLowerCase().indexOf(f) !== -1 ||
        (tool.description && tool.description.toLowerCase().indexOf(f) !== -1);
    });
  }

  function groupTools(tools) {
    var groups = { read: [], write: [], destructive: [] };
    tools.forEach(function (tool) {
      var key = tool.sideEffect || "read";
      if (!groups[key]) groups[key] = [];
      groups[key].push(tool);
    });
    return groups;
  }

  function renderList() {
    var tools = visibleTools();
    var groups = groupTools(tools);
    var html = "";

    ["read", "write", "destructive"].forEach(function (risk) {
      var group = groups[risk];
      if (!group || group.length === 0) return;
      html += '<div class="tool-group">' + risk + ' (' + group.length + ')</div>';
      group.forEach(function (tool) {
        var isSelected = tool.name === selected;
        html += '<button class="tool" data-name="' + esc(tool.name) + '" aria-selected="' + isSelected + '">' +
          '<span class="tool-indicator ' + risk + '"></span>' +
          '<span class="tool-name">' + esc(tool.name) + "</span>" +
          (!tool.enabled ? '<span class="tool-badge disabled">off</span>' : "") +
          "</button>";
      });
    });

    if (tools.length === 0) {
      html = '<div style="padding: 20px; text-align: center; color: var(--faint);">No tools match your search</div>';
    }

    listEl.innerHTML = html;

    Array.prototype.forEach.call(listEl.querySelectorAll(".tool"), function (btn) {
      btn.addEventListener("click", function () {
        selected = btn.getAttribute("data-name");
        editingField = null;
        renderList();
        renderDetail();
        // On narrow screens the detail slides over the list.
        if (appEl) appEl.classList.add("detail-open");
      });
    });
  }

  function currentTool() {
    if (!state || !selected) return null;
    return state.tools.find(function (tool) { return tool.name === selected; });
  }

  function renderDetail() {
    var tool = currentTool();
    if (!tool) {
      detailEl.hidden = true;
      placeholderEl.hidden = false;
      return;
    }

    placeholderEl.hidden = true;
    detailEl.hidden = false;

    // The verb chip carries read/write/destructive (color-coded). Badges
    // only surface what the rest of the pane does not: withholding is a
    // safety decision worth a badge, while plain disabled state is what the
    // Status toggle below already says.
    var badges = [
      !tool.enabled && tool.withheld ? '<span class="badge disabled">withheld from agents</span>' : "",
      tool.endpointRole && tool.endpointRole !== "endpoint" ? '<span class="badge auth">' + tool.endpointRole + "</span>" : "",
      tool.piiInOutput && tool.piiInOutput.length > 0 ? '<span class="badge write">pii: ' + esc(tool.piiInOutput.join(", ")) + "</span>" : "",
    ].filter(Boolean).join("");

    var findings = (tool.findings || []).map(function (finding) {
      var icon = finding.level === "error" ? "✖" : "⚠";
      return '<div class="finding ' + finding.level + '"><span class="finding-icon">' + icon + "</span><span>" + esc(finding.message) + "</span></div>";
    }).join("");

    var schema = tool.inputSchema || {};
    var properties = schema.properties || {};
    var required = schema.required || [];
    var fields = Object.keys(properties).map(function (key) {
      var field = properties[key];
      var type = field.type === "number" || field.type === "integer" ? "number" : "text";
      var req = required.indexOf(key) !== -1 ? ' <span class="req">*</span>' : "";
      var hint = field.description ? '<div class="param-hint">' + esc(field.description) + "</div>" : "";
      return '<div class="param"><label class="param-label">' + esc(key) + req + '</label>' +
        '<input class="param-input" data-param="' + esc(key) + '" data-type="' + esc(field.type || "string") + '" type="' + type + '" spellcheck="false" />' +
        hint + "</div>";
    }).join("");

    // Field descriptions: text-first rows, one Edit per row. A wall of
    // pre-filled inputs read as a second copy of the test form, and the two
    // forms sharing markup is how description text once leaked into run
    // payloads.
    var fieldOverrides = tool.fieldOverrides || {};
    var fieldRows = Object.keys(properties).map(function (key) {
      var field = properties[key];
      var isOverridden = fieldOverrides[key] !== undefined;
      var text = isOverridden ? fieldOverrides[key] : (field.description || "");
      if (editingField === key) {
        return '<div class="field-row">' +
          '<div class="field-row-head"><span class="field-name">' + esc(key) + "</span></div>" +
          '<input class="param-input" id="field-edit-input" type="text" value="' + esc(text) + '" spellcheck="false" />' +
          '<div class="edit-actions">' +
          '<button class="btn btn-primary" id="save-field">Save</button>' +
          '<button class="btn" id="cancel-field">Cancel</button>' +
          "</div></div>";
      }
      return '<div class="field-row">' +
        '<div class="field-row-head"><span class="field-name">' + esc(key) + "</span>" +
        (isOverridden ? '<span class="badge override">override</span>' : "") +
        '<button class="field-edit-btn" data-edit-field="' + esc(key) + '">Edit</button></div>' +
        '<div class="field-text">' + (text ? esc(text) : '<span class="field-empty">No description yet.</span>') + "</div>" +
        "</div>";
    }).join("");

    var baseUrl = "";
    try { baseUrl = localStorage.getItem("webmcp-codegen:baseUrl") || tool.serverUrl || ""; } catch (e) {}
    // Only route-backed tools have anything to call. Schema-only and
    // form-output tools get a note instead of a form that can only fail.
    var canRun = !!(tool.verb && tool.path);

    detailEl.innerHTML =
      '<div class="detail-header">' +
      '<div class="detail-toprow">' +
      '<button type="button" class="back-btn" id="detail-back" aria-label="Back to tools">' +
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>' +
      "</button>" +
      '<h1 class="detail-title">' + esc(tool.name) + "</h1>" +
      "</div>" +
      '<div class="detail-route">' +
      (tool.verb
        ? '<span class="verb ' + tool.sideEffect + '">' + esc(tool.verb) + "</span>" +
          "<span>" + esc(tool.path || "") + "</span>"
        : '<span class="verb ' + tool.sideEffect + '">' + esc(tool.sideEffect.toUpperCase()) + "</span>") +
      "</div>" +
      (tool.provenance
        ? '<div class="detail-provenance">' + esc(tool.provenance) + "</div>"
        : "") +
      (tool.form
        ? '<div class="detail-provenance">annotates ' + esc(tool.form.path) + " (form output; no file generated)</div>"
        : "") +
      (badges ? '<div class="badges">' + badges + "</div>" : "") +
      "</div>" +

      (findings ? '<div class="section"><div class="section-label">Audit findings</div>' + findings + "</div>" : "") +

      (tool.source
        ? '<details class="source-disclosure" id="source-disclosure">' +
          '<summary><span class="source-chevron" aria-hidden="true"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg></span>' +
          '<span class="source-label">' + esc(tool.source.fileName) + "</span>" +
          '<span class="source-hint">view source</span></summary>' +
          '<pre class="source-code"><code>' + esc(tool.source.code) + "</code></pre>" +
          "</details>"
        : "") +

      '<div class="section">' +
      '<div class="section-label">Description</div>' +
      '<textarea class="description-edit" id="desc" spellcheck="false">' + esc(tool.description) + "</textarea>" +
      '<div class="edit-actions">' +
      '<button class="btn btn-primary" id="save-desc">Save</button>' +
      '<span class="saved-indicator" id="saved">Saved</span>' +
      "</div>" +
      '<div class="edit-hint">Agents pick tools by this text. Saved to .webmcp-codegen.json, so it survives regeneration. ⌘S to save.</div>' +
      "</div>" +

      (fieldRows
        ? '<div class="section">' +
          '<div class="section-label">Field descriptions</div>' +
          '<div class="field-list">' + fieldRows + "</div>" +
          '<div class="edit-hint">Agents fill inputs from this text. Saved per field to .webmcp-codegen.json, so it survives regeneration.</div>' +
          "</div>"
        : "") +

      '<div class="section">' +
      '<div class="section-label">Status</div>' +
      '<div class="toggle-row">' +
      '<button class="switch" id="toggle-enabled" role="switch" aria-checked="' + tool.enabled + '" aria-label="Enabled"></button>' +
      '<div class="toggle-copy"><strong>' + (tool.enabled ? "Enabled" : "Disabled") + "</strong>" +
      (tool.enabled
        ? "This tool works as soon as the app registers it."
        : "The generated code is there, commented out. Flipping this regenerates it enabled on the next run.") +
      "</div></div>" +
      "</div>" +

      (canRun
        ? '<div class="section">' +
          '<div class="section-label">Test</div>' +
          '<div class="try-section">' +
          '<div class="try-header"><h3>Run this tool</h3><span class="try-note">server-side, no browser session</span></div>' +
          '<div class="try-body">' +
          (tool.requiresAuth
            ? '<div class="auth-note">⚠ This endpoint requires a browser session. The dashboard runs server-side, so you will get a 401. Test it in Chrome DevTools where you are signed in.</div>'
            : "") +
          '<input class="base-url-input" id="base-url" type="text" placeholder="Base URL (e.g. http://localhost:3000)" value="' + esc(baseUrl) + '" spellcheck="false" />' +
          (fields || '<div style="color: var(--faint); font-size: 13px; margin-bottom: 14px;">This tool takes no inputs.</div>') +
          '<button class="run-btn" id="run">Run tool</button>' +
          '<pre class="result" id="result" hidden></pre>' +
          "</div></div>" +
          "</div>"
        : '<div class="section">' +
          '<div class="section-label">Test</div>' +
          '<div class="empty-note">' +
          (tool.form
            ? "This tool annotates a form on the page; there is no endpoint to call."
            : "This tool has no endpoint, so there is nothing to run from the dashboard.") +
          "</div></div>");

    document.getElementById("save-desc").addEventListener("click", saveDescription);
    Array.prototype.forEach.call(detailEl.querySelectorAll("[data-edit-field]"), function (btn) {
      btn.addEventListener("click", function () {
        editingField = btn.getAttribute("data-edit-field");
        renderDetail();
        var input = document.getElementById("field-edit-input");
        if (input) {
          input.focus();
          input.setSelectionRange(input.value.length, input.value.length);
        }
      });
    });
    var saveFieldBtn = document.getElementById("save-field");
    if (saveFieldBtn) saveFieldBtn.addEventListener("click", saveFieldEdit);
    var cancelFieldBtn = document.getElementById("cancel-field");
    if (cancelFieldBtn) {
      cancelFieldBtn.addEventListener("click", function () {
        editingField = null;
        renderDetail();
      });
    }
    var backBtn = document.getElementById("detail-back");
    if (backBtn) {
      backBtn.addEventListener("click", function () {
        if (appEl) appEl.classList.remove("detail-open");
      });
    }
    document.getElementById("toggle-enabled").addEventListener("click", toggleEnabled);
    var runBtn = document.getElementById("run");
    if (runBtn) runBtn.addEventListener("click", runTool);
    var baseUrlInput = document.getElementById("base-url");
    if (baseUrlInput) {
      baseUrlInput.addEventListener("change", function (event) {
        try { localStorage.setItem("webmcp-codegen:baseUrl", event.target.value); } catch (e) {}
      });
    }
  }

  function saveDescription() {
    var tool = currentTool();
    var desc = document.getElementById("desc").value.trim();
    if (!tool || !desc) return;
    api("/api/override", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: tool.name, description: desc }),
    }).then(function () {
      tool.description = desc;
      var saved = document.getElementById("saved");
      saved.classList.add("show");
      setTimeout(function () { saved.classList.remove("show"); }, 2000);
    }).catch(function (error) { alert(error.message); });
  }

  function saveFieldEdit() {
    var tool = currentTool();
    var input = document.getElementById("field-edit-input");
    if (!tool || !input || !editingField) return;
    var value = input.value.trim();
    if (!value) return;
    var fields = {};
    fields[editingField] = value;
    api("/api/override", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: tool.name, fields: fields }),
    }).then(function () {
      tool.fieldOverrides = Object.assign({}, tool.fieldOverrides, fields);
      editingField = null;
      renderDetail();
    }).catch(function (error) { alert(error.message); });
  }

  function toggleEnabled() {
    var tool = currentTool();
    if (!tool) return;
    var next = !tool.enabled;
    api("/api/override", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: tool.name, enabled: next }),
    }).then(function () {
      tool.enabled = next;
      renderList();
      renderDetail();
    }).catch(function (error) { alert(error.message); });
  }

  function runTool() {
    var tool = currentTool();
    if (!tool) return;
    var input = {};
    // Only the test form's inputs carry data-param, and the description
    // editor is read by id: field text can never become a request value.
    Array.prototype.forEach.call(document.querySelectorAll("[data-param]"), function (field) {
      var value = field.value;
      if (value === "") return;
      var type = field.getAttribute("data-type");
      if (type === "number" || type === "integer") value = Number(value);
      if (type === "boolean") value = value === "true";
      if (type === "object" || type === "array") {
        try { value = JSON.parse(value); } catch (e) { /* keep as string */ }
      }
      input[field.getAttribute("data-param")] = value;
    });
    var baseUrl = document.getElementById("base-url").value.trim();
    var resultEl = document.getElementById("result");
    var runEl = document.getElementById("run");
    runEl.disabled = true;
    runEl.textContent = "Running...";
    resultEl.hidden = true;
    api("/api/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: tool.name, input: input, baseUrl: baseUrl || undefined }),
    }).then(function (result) {
      resultEl.hidden = false;
      resultEl.className = "result " + (result.ok ? "ok" : "err");
      resultEl.textContent =
        (result.status ? "HTTP " + result.status + "\\n\\n" : "") +
        (result.error ? result.error : JSON.stringify(result.body, null, 2));
    }).catch(function (error) {
      resultEl.hidden = false;
      resultEl.className = "result err";
      resultEl.textContent = error.message;
    }).finally(function () {
      runEl.disabled = false;
      runEl.textContent = "Run tool";
    });
  }

  /* Keyboard navigation */
  document.addEventListener("keydown", function (event) {
    if ((event.metaKey || event.ctrlKey) && event.key === "k") {
      event.preventDefault();
      searchEl.focus();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key === "s") {
      event.preventDefault();
      // ⌘S saves whatever is being edited: an open field row, else the
      // tool description.
      if (document.getElementById("field-edit-input")) saveFieldEdit();
      else saveDescription();
      return;
    }
    if (event.target === searchEl || event.target.tagName === "TEXTAREA" || event.target.tagName === "INPUT") {
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    var tools = visibleTools();
    var index = tools.findIndex(function (tool) { return tool.name === selected; });
    var next = event.key === "ArrowDown" ? index + 1 : index - 1;
    if (next < 0 || next >= tools.length) return;
    event.preventDefault();
    selected = tools[next].name;
    editingField = null;
    renderList();
    renderDetail();
    var button = listEl.querySelector('[aria-selected="true"]');
    if (button) button.scrollIntoView({ block: "nearest" });
  });

  searchEl.addEventListener("input", function (event) {
    filter = event.target.value;
    renderList();
  });

  // Resizable sidebar: drag the handle, double-click to reset. Pointer
  // capture on the handle routes every move/up to it, which keeps working
  // even inside a shadow root (where window-level listeners miss retargeted
  // events). The width is clamped between the sidebar's min and max.
  (function () {
    var handle = document.getElementById("sidebar-resize");
    var sidebar = document.querySelector(".sidebar");
    if (!handle || !sidebar) return;
    var startX = 0;
    var startWidth = 0;

    function onMove(event) {
      var width = Math.min(480, Math.max(240, startWidth + (event.clientX - startX)));
      sidebar.style.width = width + "px";
    }
    function onUp(event) {
      document.body.classList.remove("resizing");
      try { handle.releasePointerCapture(event.pointerId); } catch (e) {}
      handle.removeEventListener("pointermove", onMove, true);
      handle.removeEventListener("pointerup", onUp, true);
      handle.removeEventListener("pointercancel", onUp, true);
    }
    handle.addEventListener("pointerdown", function (event) {
      startX = event.clientX;
      startWidth = sidebar.getBoundingClientRect().width;
      document.body.classList.add("resizing");
      try { handle.setPointerCapture(event.pointerId); } catch (e) {}
      // Capture phase: with pointer capture the move/up are targeted at the
      // handle, and capture-phase listeners are the reliable way to see them.
      handle.addEventListener("pointermove", onMove, true);
      handle.addEventListener("pointerup", onUp, true);
      handle.addEventListener("pointercancel", onUp, true);
      event.preventDefault();
    });
    handle.addEventListener("dblclick", function () {
      sidebar.style.width = "";
    });
  })();

  load();
})();
</script>
</body>
</html>`;
}
