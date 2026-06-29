import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Access pending · Pickle Point",
  description: "Your sign-in could not be completed.",
  robots: { index: false, follow: false },
};

/**
 * Safe landing page for failed sign-in reconciliation.
 *
 * This page is intentionally static: no authentication, no data
 * fetching, no query parameters, and no reflection of any token, claim,
 * organization id, email, or internal error. The AuthKit callback
 * `onError` redirects here with a fixed URL so a reconciliation failure
 * never leaks sensitive data in the response.
 */
export default function SupportAccessPage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <section className="mx-auto flex min-h-screen w-full max-w-xl flex-col justify-center gap-6 px-6 py-12">
        <div className="space-y-4">
          <p className="text-sm font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Access pending
          </p>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            We couldn&rsquo;t finish signing you in
          </h1>
          <p className="text-lg leading-8 text-muted-foreground">
            Something went wrong while preparing your workspace access. Your
            account may still be awaiting an invitation, or we couldn&rsquo;t
            confirm the details needed to sign you in.
          </p>
          <p className="text-base leading-7 text-muted-foreground">
            You can try signing in again. If the problem continues, contact
            your workspace owner and ask them to check your membership.
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Link
            href="/sign-in"
            className="inline-flex h-11 items-center justify-center rounded-md bg-foreground px-5 text-sm font-medium text-background transition-colors hover:bg-foreground/90"
          >
            Try signing in again
          </Link>
          <Link
            href="/"
            className="inline-flex h-11 items-center justify-center rounded-md border border-border bg-background px-5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
          >
            Back to home
          </Link>
        </div>
      </section>
    </main>
  );
}
