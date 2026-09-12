import "./global.css";
import { RootProvider } from "fumadocs-ui/provider";
import type { Metadata, Viewport } from "next";
import { Caveat, Inter, JetBrains_Mono, Space_Grotesk } from "next/font/google";
import type { ReactNode } from "react";
import { SITE_URL } from "@/lib/site-url";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const spaceGrotesk = Space_Grotesk({ subsets: ["latin"], variable: "--font-space-grotesk" });
const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains-mono" });
const caveat = Caveat({ subsets: ["latin"], variable: "--font-caveat" });

const DESCRIPTION =
  "Turn an OpenAPI spec into safe, typed, human-reviewed WebMCP tools. Real files in your repo: contracts regenerate, your code survives, safety audit built in.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    template: "%s | webmcp-stack",
    default: "webmcp-stack: generate WebMCP tools from the API spec you already have",
  },
  description: DESCRIPTION,
  keywords: [
    "WebMCP",
    "MCP",
    "AI agents",
    "OpenAPI",
    "code generation",
    "agent tools",
    "model context protocol",
  ],
  openGraph: {
    type: "website",
    siteName: "webmcp-stack",
    title: "webmcp-stack: generate WebMCP tools from the API spec you already have",
    description: DESCRIPTION,
    images: [{ url: "/og-image.png", width: 1200, height: 630, alt: "webmcp-stack" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "webmcp-stack: generate WebMCP tools from the API spec you already have",
    description: DESCRIPTION,
    images: ["/og-image.png"],
  },
  robots: { index: true, follow: true },
};

// Lock the page to the viewport so the embedded dashboard reads as an app,
// not a document that pans under a pinch.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} ${spaceGrotesk.variable} ${jetbrainsMono.variable} ${caveat.variable}`}
    >
      <body className="flex flex-col min-h-screen">
        <RootProvider>{children}</RootProvider>
      </body>
    </html>
  );
}
