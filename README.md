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
   - `NEXT_PUBLIC_WORKOS_REDIRECT_URI` - AuthKit callback URL, usually `http://localhost:3000/callback`.

4. Start Convex during backend work:

   ```bash
   pnpm exec convex dev
   ```

## Running the Project

```bash
# Development server
pnpm dev

# Build for production
pnpm build

# Start production server
pnpm start

# Run linting
pnpm lint
```

The app will be available at [http://localhost:3000](http://localhost:3000).
Living documentation is available at [http://localhost:3000/docs](http://localhost:3000/docs).

## Project Structure

```text
pickle-point/
├── convex/               # Convex schema, queries, mutations, and generated types
├── content/docs/         # Fumadocs MDX product and technical docs
├── src/
│   ├── app/              # Next.js App Router pages and routes
│   ├── components/       # React components
│   └── lib/              # Utilities, validation, docs source, and stores
├── public/               # Static assets
└── package.json
```

## Current Features

- White-label tenant routing with configurable theme colors.
- Convex-backed doubles team registration.
- WorkOS AuthKit session wiring for protected Game Master admin routes.
- Game Master dashboard for viewing registered teams by skill tier.
- Round-robin tournament bracket generation by skill tier.
- Versioned in-repo product and technical documentation at `/docs`.

## MVP Backlog

The current product and cleanup backlog lives in `PRD-NEW.md`. Key next areas include:

- Open play sessions, queue management, and live player views.
- Tournament match result entry and bracket advancement.
- Convex-backed realtime subscriptions for player and Game Master screens.
- Auth identity mapping and account linking on top of WorkOS AuthKit.

## Backend Notes

Convex is the target backend for persistence, server functions, and realtime state. Turso, Drizzle schema files, Drizzle migrations, and SQL-first server actions are no longer part of the target architecture.

When editing Convex code, read `convex/_generated/ai/guidelines.md` first. Those generated project guidelines override generic Convex assumptions.

## Learn More

- [Next.js Documentation](https://nextjs.org/docs)
- [Convex Documentation](https://docs.convex.dev/)
- [Fumadocs Documentation](https://fumadocs.dev/)
- [shadcn/ui](https://ui.shadcn.com/)
