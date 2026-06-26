# Unified Development Command

## Goal

Make the default `pnpm dev` command start both the Convex backend watcher and the Next.js development server so local development does not require two manually managed terminals.

## Design

- Change `dev` to run `convex dev --start 'next dev'`.
- Add `dev:frontend` as `next dev` for the occasional frontend-only workflow.
- Use Convex's built-in process supervision rather than adding a dependency such as `concurrently`.
- Update the README so setup and running instructions describe the unified command and the frontend-only escape hatch.

## Behavior and Failure Handling

Convex initializes and watches the configured development deployment, then starts Next.js alongside it. Startup failures remain visible in the shared terminal. Stopping the command stops the coordinated development session.

## Verification

- Confirm `package.json` remains valid JSON and pnpm lists both scripts.
- Run the frontend-only script briefly to confirm it invokes Next.js.
- Run the unified command briefly, when local Convex credentials and network access allow, and confirm both processes begin startup.
- Run the existing test suite to catch regressions.
