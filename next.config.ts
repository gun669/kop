import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The /api/setup route reads SQL migration files from ./drizzle at request
  // time (not via a JS import), so Next's file tracing won't pick them up
  // for the deployed serverless function on its own — without this, the
  // files simply aren't present on Vercel and migrate() fails with
  // "Can't find meta/_journal.json file".
  outputFileTracingIncludes: {
    "/api/setup": ["./drizzle/**/*"],
  },
};

export default nextConfig;
