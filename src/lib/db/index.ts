import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import * as schema from './schema';

const isProduction = process.env.NODE_ENV === 'production';

// In standard Next.js, local.env or .env.local are usually loaded automatically.
const dbUrl = process.env.TURSO_DB_URL;
const dbToken = process.env.TURSO_DB_TOKEN;

if (!dbUrl) {
  throw new Error('TURSO_DB_URL is not defined');
}

if (!dbToken && isProduction) {
  throw new Error('TURSO_DB_TOKEN is not defined in production');
}

const client = createClient({
  url: dbUrl,
  authToken: dbToken,
});

export const db = drizzle(client, { schema });
