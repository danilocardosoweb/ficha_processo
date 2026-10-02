import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The local app is commonly opened as 127.0.0.1 while Next runs on
  // localhost. Without this allow-list the dev HMR request is blocked, the
  // client form handler never hydrates, and forms fall back to a GET URL.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  outputFileTracingIncludes: { "/api/planning-agents": ["./src/modules/planning/agents/skills/*/SKILL.md"] },
  async headers() {
    return [{
      source: "/sw.js",
      headers: [
        { key: "Content-Type", value: "application/javascript; charset=utf-8" },
        { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
        { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
      ],
    }];
  },
};

export default nextConfig;
