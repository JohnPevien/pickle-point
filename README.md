# Pickle Point

A white-labeled, multi-tenant B2B SaaS application for pickleball tournament management. Built for community coordinators (Game Masters) to organize and run pickleball tournaments with registration, bracket generation, court allocation, and score tracking.

## Tech Stack

| Category | Technology |
|----------|------------|
| Framework | Next.js 16.1.6 |
| Language | TypeScript 5.x |
| Runtime | Node.js 20+ |
| UI | React 19, Tailwind CSS 4, Radix UI + shadcn/ui |
| Database | Turso (libSQL) with Drizzle ORM |
| State | Zustand |
| Package Manager | pnpm |

## Prerequisites

- Node.js 20+
- pnpm

## Installation

1. **Clone the repository**
   ```bash
   cd C:\code\github-repositories\pickle-point
   ```

2. **Install dependencies**
   ```bash
   pnpm install
   ```

3. **Set up environment variables**
   ```bash
   # Copy local.env to .env.local and update with your values
   cp local.env .env.local
   ```

   Required environment variables:
   - `TURSO_DB_URL` - Turso database URL (libsql://...)
   - `TURSO_DB_TOKEN` - Turso database authentication token
   - `THEME` - Theme name (e.g., "blackpink")

4. **Run database migrations**
   ```bash
   pnpm drizzle-kit push
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

## Project Structure

```
pickle-point/
├── src/
│   ├── app/              # Next.js App Router pages
│   ├── components/       # React components
│   ├── lib/              # Utilities, DB, stores
│   │   ├── db/           # Drizzle configuration & schema
│   │   └── validations/  # Zod schemas
│   └── ...
├── public/               # Static assets
├── drizzle/              # Drizzle migrations
├── drizzle.config.ts     # Drizzle configuration
└── package.json
```

## Features

### Completed Features
- **White-Label Configuration** - Dynamic tenant routing with customizable brand colors
- **Registration Workflow** - Multi-step team/participant registration with duplicate validation

### Pending Features (MVP)
- Administrative Dashboard & Bracket Generation
- Real-Time Court Allocation System
- Score Documentation & Bracket Advancement

## Database

The project uses Drizzle ORM with Turso (libSQL). Schema changes are managed via:
- `drizzle-kit push` - Push schema changes to database
- `drizzle-kit studio` - Visual database studio

## Dependencies

### Core
- `next@16.1.6` - React framework
- `react@19.2.3` - UI library
- `typescript@5` - Type safety

### UI & Styling
- `tailwindcss@4` - CSS framework
- `radix-ui@1.4.3` - Accessible primitives
- `shadcn@3.8.5` - UI component library
- `lucide-react@0.575.0` - Icons

### Data & Validation
- `drizzle-orm@0.45.1` - Database ORM
- `@libsql/client@0.17.0` - Turso client
- `zod@4.3.6` - Schema validation
- `react-hook-form@7.71.2` - Form handling

### State & Utilities
- `zustand@5.0.11` - State management
- `sonner@2.0.7` - Toast notifications
- `tailwind-merge@3.5.0` - Utility for class merging

## Learn More

- [Next.js Documentation](https://nextjs.org/docs)
- [Drizzle ORM Docs](https://orm.drizzle.team/)
- [Turso Documentation](https://docs.turso.tech/)
- [shadcn/ui](https://ui.shadcn.com/)
