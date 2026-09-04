// CLI entry point for `npm run db:seed` — clears and reseeds demo data
// against whatever database DATABASE_URL points at. The reusable logic
// lives in seed.ts so it can also run from the /api/setup route.
import { seed } from "./seed";

seed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
