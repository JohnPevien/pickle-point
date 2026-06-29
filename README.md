# Pickle Point

Pickle Point is a white-labeled, multi-tenant pickleball operations app for Game Masters: venue owners, club organizers, and anyone running open play sessions or mini tournaments.

The current MVP direction uses Convex for persistence and realtime sync, with browser-openable living documentation available at `/docs`.

## Tech Stack

| Category | Technology |
|----------|------------|
| Framework | Next.js 16.1.6 |
| Language | TypeScript 5.x |
| Runtime | Node.js 22.11+ |
| UI | React 19, Tailwind CSS 4, Radix UI + shadcn/ui |
| Backend | Convex |
| Docs | Fumadocs + MDX |
| State | Zustand |
| Package Manager | pnpm |

## Prerequisites

- Node.js 22.11+
- pnpm
- A Convex project for local backend development
- WorkOS AuthKit credentials for protected Game Master routes

## Installation

1. Clone the repository:

   ```bash
   git clone <repository-url>
   cd pickle-point
   ```

2. Install dependencies:

   ```bash
   pnpm install
   ```

3. Set up environment variables:

   ```bash
   cp local.env .env.local
   ```

   Common local variables:

   - `NEXT_PUBLIC_CONVEX_URL` - Convex deployment URL used by the browser client.
   - `CONVEX_DEPLOYMENT` - Convex deployment identifier for local tooling.
   - `THEME` - Optional theme name, currently `gaming` or `blackpink`.
   - `WORKOS_CLIENT_ID` - WorkOS AuthKit client ID.
   - `WORKOS_API_KEY` - WorkOS API key. Keep this server-side only.
   - `WORKOS_COOKIE_PASSWORD` - AuthKit session cookie secret, at least 32 characters.
   - `WORKOS_COOKIE_MAX_AGE` - AuthKit session cookie maximum age in seconds. Set to `604800` (seven days) for all authenticated accounts.
   - `NEXT_PUBLIC_WORKOS_REDIRECT_URI` - AuthKit callback URL, usually `http://localhost:3000/callback`.
   - `WORKOS_WEBHOOK_SECRET` - Secret used to sign the WorkOS webhook delivery. Required to verify `/workos/webhooks`. Never commit a real value.
   - `WORKOS_ORGANIZATION_ID` - Canonical WorkOS organization ID for the fixed tenant. Used to confirm every administrative webhook/claim targets the correct organization.
   - `PICKLE_POINT_TENANT_SLUG` - Friendly slug for the single fixed tenant (e.g. `manila`).
   - `PICKLE_POINT_TENANT_TIMEZONE` - IANA timezone applied to the tenant; defaults to `Asia/Manila`.

4. Start the Convex backend watcher and Next.js development server:

   ```bash
   pnpm dev
   ```

## Running the Project

```bash
# Convex backend and Next.js frontend
pnpm dev

# Next.js frontend only
pnpm dev:frontend

# Build for production
pnpm build

# Start production server
pnpm start

# Run linting
pnpm lint

# Run tests
pnpm test
```

The app will be available at [http://localhost:3000](http://localhost:3000).
Living documentation is available at [http://localhost:3000/docs](http://localhost:3000/docs).

## Project Structure

```text
pickle-point/
├── convex/               # Convex schema, queries, mutations, and generated types
├── docs/                 # Fumadocs MDX product and technical docs
├── src/
│   ├── app/              # Next.js App Router pages and routes
│   ├── components/       # React components
│   └── lib/              # Utilities, validation, docs source, and stores
├── public/               # Static assets
└── package.json
```

## Current Features

- White-label tenant routing with configurable workspace theme colors.
- WorkOS AuthKit integration for protected Game Master admin routes.
- First-run workspace setup and workspace settings.
- Venue management with court counts used by Open Play generation.
- Player directory management with manual skill and optional DUPR data.
- Accountless guest and walk-in player records for MVP participation.
- Open Play session creation, check-in, fair rotation, score entry, manual match adjustment, QR sharing, and public live views.
- Tournament creation, fixed-doubles entrants, seed editing, single elimination, double elimination, round robin, score correction, QR sharing, and public bracket views.
- Versioned in-repo product and technical documentation at `/docs`.

## MVP Readiness

The canonical task queue lives in `docs/task-log/`. As of the MVP readiness pass, the remaining work is release polish: keeping docs in sync, validating the app, and recording any follow-up discovered during real Game Master usage.

Future features are tracked in `docs/roadmap.mdx`, including AI-assisted matching, player account claim/link flow, singles tournaments, and random social pairing modes.

## Backend Notes

Convex is the target backend for persistence, server functions, and realtime state. Turso, Drizzle schema files, Drizzle migrations, and SQL-first server actions are no longer part of the target architecture.

When editing Convex code, read `convex/_generated/ai/guidelines.md` first. Those generated project guidelines override generic Convex assumptions.

## Authentication Notes

WorkOS AuthKit remains the identity provider. Convex ships with automatic AuthKit
configuration; we extend it for direct SDK access:

- `@workos-inc/node` is used by Convex HTTP actions and server actions to verify
  webhook signatures and to resolve organization membership server-side.
- The browser never supplies tenant, user, organization, membership, or role
  authority. AuthKit JWT claims and signed webhook deliveries are the only
  trusted sources.
- The AuthKit application cookie maximum age is fixed to seven days
  (`WORKOS_COOKIE_MAX_AGE=604800`). There is no per-tenant or per-role
  reauthentication layer.
- Game Master invitations use WorkOS default expiration; no custom
  `expiresInDays` is configured.
- Webhook events are delivered to `/workos/webhooks` and verified with the
  raw body and signature header inside a `"use node"` action before any
  database write.

## Learn More

- [Next.js Documentation](https://nextjs.org/docs)
- [Convex Documentation](https://docs.convex.dev/)
- [Fumadocs Documentation](https://fumadocs.dev/)
- [shadcn/ui](https://ui.shadcn.com/)
