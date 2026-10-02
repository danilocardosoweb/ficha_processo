import type { NextConfig } from "next";

const appVersion = process.env.npm_package_version ?? "0.1.0";
const appCommit = process.env.VERCEL_GIT_COMMIT_SHA ?? "local";
const appEnvironment = process.env.VERCEL_ENV ?? "local";
const appBuildDate = new Date().toISOString();

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_APP_VERSION: appVersion,
    NEXT_PUBLIC_APP_COMMIT: appCommit,
    NEXT_PUBLIC_APP_ENVIRONMENT: appEnvironment,
    NEXT_PUBLIC_APP_BUILD_DATE: appBuildDate,
  },
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
