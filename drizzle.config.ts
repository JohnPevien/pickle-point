import { defineConfig } from "drizzle-kit";
import * as dotenv from "dotenv";

// Load environment variables from local.env or .env.local
dotenv.config({ path: ".env.local" });
dotenv.config({ path: "local.env" });

export default defineConfig({
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "turso",
  dbCredentials: {
    url: process.env.TURSO_DB_URL!,
    authToken: process.env.TURSO_DB_TOKEN,
  },
});
