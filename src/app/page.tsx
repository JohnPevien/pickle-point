import Link from "next/link";
import { ArrowRight, CalendarDays, ListChecks, Trophy } from "lucide-react";
import { HOME_ACTIONS } from "@/lib/home/actions";

const highlights = [
  {
    title: "Run open play",
    description: "Create sessions, check players in, fill empty courts, record scores, and share live QR links.",
    icon: CalendarDays,
  },
  {
    title: "Manage players",
    description: "Keep reusable player records with guest, walk-in, manual skill, and optional DUPR data.",
    icon: ListChecks,
  },
  {
    title: "Host mini tournaments",
    description: "Generate fixed-doubles brackets for single elimination, double elimination, and round robin.",
    icon: Trophy,
  },
];

function actionClass(variant: "primary" | "secondary") {
  if (variant === "primary") {
    return "bg-foreground text-background hover:bg-foreground/90";
  }

  return "border border-border bg-background text-foreground hover:bg-muted";
}

export default function Home() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <section className="mx-auto flex min-h-screen w-full max-w-6xl flex-col justify-center gap-12 px-6 py-10 lg:px-8">
        <nav className="flex items-center justify-between gap-4">
          <Link href="/" className="text-lg font-semibold tracking-tight">
            Pickle Point
          </Link>
          <div className="flex items-center gap-2">
            {HOME_ACTIONS.map((action) => (
              <Link
                key={action.key}
                href={action.href}
                className="rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                {action.label}
              </Link>
            ))}
          </div>
        </nav>

        <div className="grid items-center gap-10 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-8">
            <div className="space-y-5">
              <p className="text-sm font-medium uppercase tracking-[0.18em] text-muted-foreground">
                Pickleball operations for Game Masters
              </p>
              <h1 className="max-w-3xl text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
                Run open plays and small tournaments from one live control surface.
              </h1>
              <p className="max-w-2xl text-lg leading-8 text-muted-foreground">
                Pickle Point helps club organizers manage workspaces, venues, players, fair rotations,
                score entry, live player views, QR links, and fixed-doubles tournament brackets.
              </p>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row">
              {HOME_ACTIONS.map((action) => (
                <Link
                  key={action.key}
                  href={action.href}
                  className={`inline-flex h-11 items-center justify-center gap-2 rounded-md px-5 text-sm font-medium transition-colors ${actionClass(action.variant)}`}
                >
                  {action.label}
                  {action.variant === "primary" ? <ArrowRight className="size-4" /> : null}
                </Link>
              ))}
            </div>
          </div>

          <div className="rounded-lg border bg-muted/30 p-5">
            <div className="space-y-4">
              <div>
                <p className="text-sm font-medium text-muted-foreground">MVP workflow</p>
                <h2 className="mt-1 text-2xl font-semibold tracking-tight">From check-in to live results</h2>
              </div>
              <div className="grid gap-3">
                {highlights.map((item) => {
                  const Icon = item.icon;
                  return (
                    <div key={item.title} className="rounded-md border bg-background p-4">
                      <div className="flex items-start gap-3">
                        <div className="rounded-md bg-primary/10 p-2 text-primary">
                          <Icon className="size-4" />
                        </div>
                        <div className="space-y-1">
                          <h3 className="font-medium">{item.title}</h3>
                          <p className="text-sm leading-6 text-muted-foreground">{item.description}</p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
