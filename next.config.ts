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

  // Next's default Server Actions body limit is 1MB — well under the 4MB
  // the teacher-photo upload action means to allow (see profile/actions.ts).
  // Without this, a file between ~1MB and 4MB never reaches that action's
  // own size check at all; it's rejected earlier with a bare 500. Matches
  // (just under) Vercel's own 4.5MB server-upload cap for Blob.
  experimental: {
    serverActions: {
      bodySizeLimit: "4.5mb",
    },
  },
};

export default nextConfig;
