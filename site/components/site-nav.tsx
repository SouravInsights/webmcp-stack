"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Logo } from "@/components/logo";

const REPO = "https://github.com/SouravInsights/webmcp-stack";

const LINKS: Array<{ href: string; label: string; external?: boolean }> = [
  { href: "/playground", label: "playground" },
  { href: "/docs", label: "docs" },
  { href: "/about", label: "about" },
  { href: "/brand", label: "brand" },
  { href: REPO, label: "github", external: true },
];

/**
 * The shared marketing nav. Full links from `sm` up; below that a
 * menu button whose three strokes are the stack layers: opening
 * flattens them into an ✕, and the menu takes over the viewport with
 * the links fading in one by one.
 */
export function SiteNav({ overlay = false, product }: { overlay?: boolean; product?: string }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const close = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open]);

  const linkClass = "transition-colors duration-150 hover:text-ink";
  const linkStyle = { transitionTimingFunction: "var(--ease-reading)" } as const;

  return (
    <header
      className={overlay ? "absolute inset-x-0 top-0 z-30" : "relative z-30 border-b border-line"}
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 sm:px-6">
        <Link
          href="/"
          aria-label="webmcp-stack home"
          className="shrink-0"
          onClick={() => setOpen(false)}
        >
          <Logo product={product} />
        </Link>

        <nav className="hidden items-center gap-6 font-mono text-[13px] text-dim sm:flex">
          {LINKS.map((l) =>
            l.external ? (
              <a key={l.label} href={l.href} className={linkClass} style={linkStyle}>
                {l.label}
              </a>
            ) : (
              <Link key={l.label} href={l.href} className={linkClass} style={linkStyle}>
                {l.label}
              </Link>
            ),
          )}
        </nav>

        {/* Mobile: the stack as a menu button. Closed, three layers;
            open, the layers flatten into an ✕. */}
        <button
          type="button"
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="relative z-40 flex size-9 items-center justify-center text-dim transition-colors hover:text-ink sm:hidden"
        >
          <svg viewBox="0 0 20 20" fill="none" className="size-5" aria-hidden="true">
            <path
              d={open ? "M5.5 5.5 L14.5 14.5" : "M3.5 5.5 H16.5"}
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              className="menu-stroke"
            />
            <path
              d="M3.5 10 H16.5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              className="menu-stroke"
              style={{
                opacity: open ? 0 : 1,
                transform: open ? "scaleX(0.4)" : "none",
                transformOrigin: "center",
              }}
            />
            <path
              d={open ? "M14.5 5.5 L5.5 14.5" : "M3.5 14.5 H13"}
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              className="menu-stroke"
            />
          </svg>
        </button>
      </div>

      {/* Mobile menu: one sheet sliding down onto the stack. The button
          flattens its layers into an ✕; the menu is the layer being
          placed. Rows keep the eyebrow/link language of the docs. */}
      <div
        className={`absolute inset-x-5 top-[4.25rem] z-30 sm:hidden ${
          open ? "menu-panel-open pointer-events-auto" : "pointer-events-none opacity-0"
        }`}
        aria-hidden={!open}
      >
        <nav className="menu-sheet border border-line bg-panel shadow-xl shadow-black/50">
          <p
            className="menu-link border-b border-line px-4 pb-2 pt-3 font-mono text-[10px] uppercase tracking-[0.22em] text-ghost"
            style={{ animationDelay: "40ms" }}
          >
            menu
          </p>
          {LINKS.map((l, i) => {
            const cls =
              "menu-link group/mi flex items-center justify-between px-4 py-3 font-mono text-[14px] text-dim transition-colors duration-150 hover:text-ink" +
              (i < LINKS.length - 1 ? " border-b border-line" : "");
            const style = { animationDelay: `${100 + i * 60}ms` };
            const inner = (
              <>
                <span>{l.label}</span>
                <span
                  aria-hidden="true"
                  className="text-[13px] text-ghost transition-all duration-200 group-hover/mi:translate-x-0.5 group-hover/mi:text-accent"
                >
                  {l.external ? "↗" : "→"}
                </span>
              </>
            );
            return l.external ? (
              <a
                key={l.label}
                href={l.href}
                className={cls}
                style={style}
                onClick={() => setOpen(false)}
              >
                {inner}
              </a>
            ) : (
              <Link
                key={l.label}
                href={l.href}
                className={cls}
                style={style}
                onClick={() => setOpen(false)}
              >
                {inner}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
