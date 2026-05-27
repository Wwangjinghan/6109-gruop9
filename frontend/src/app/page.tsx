import { IntentForm } from "@/components/IntentForm";
import Link from "next/link";
import { Activity, BarChart3, Boxes, ShieldCheck } from "lucide-react";

export default function Home() {
  return (
    <div className="min-h-full">
      <section className="border-b border-border/60">
        <div className="mx-auto grid w-full max-w-7xl gap-8 px-6 py-8 lg:grid-cols-[minmax(0,1fr)_420px] lg:py-10">
          <div className="flex min-h-[420px] flex-col justify-between">
            <div className="max-w-2xl space-y-5">
              <div className="inline-flex items-center gap-2 rounded-md border border-border/70 bg-card px-3 py-1 text-xs text-muted-foreground">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                Local ERC-4337 intent batching demo
              </div>
              <div className="space-y-3">
                <h1 className="text-4xl font-semibold leading-tight tracking-normal text-foreground md:text-5xl">
                  AgentIntent Protocol
                </h1>
                <p className="max-w-xl text-base leading-7 text-muted-foreground">
                  Create a typed intent, sign it off-chain, and let the relayer batch it into an ERC-4337 user operation.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link
                  href="/dashboard"
                  className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                >
                  <BarChart3 className="h-4 w-4" />
                  Open dashboard
                </Link>
                <a
                  href="http://localhost:3001/health"
                  className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-background px-3 text-sm font-medium text-foreground hover:bg-accent"
                >
                  <Activity className="h-4 w-4" />
                  Relayer health
                </a>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <StatusCard
                icon={<ShieldCheck className="h-4 w-4" />}
                title="Typed"
                value="SWAP / TRANSFER / DCA / REBALANCE"
              />
              <StatusCard
                icon={<Boxes className="h-4 w-4" />}
                title="Batched"
                value="Window and size based queue"
              />
              <StatusCard
                icon={<BarChart3 className="h-4 w-4" />}
                title="Measured"
                value="Latency, status, and gas metrics"
              />
            </div>
          </div>

          <div className="rounded-lg border border-border/70 bg-card p-4 shadow-sm">
            <IntentForm />
          </div>
        </div>
      </section>

      <section className="mx-auto grid w-full max-w-7xl gap-3 px-6 py-5 md:grid-cols-4">
        {[
          ["1", "Connect wallet", "Use the browser wallet account as the intent signer."],
          ["2", "Fill intent", "Choose an action and use the demo presets for local testing."],
          ["3", "Sign off-chain", "The browser signs the typed payload before submission."],
          ["4", "Track execution", "Watch the queue and gas data in the dashboard."],
        ].map(([step, title, body]) => (
          <div key={step} className="rounded-lg border border-border/60 bg-background p-4">
            <div className="mb-3 flex h-7 w-7 items-center justify-center rounded-md bg-secondary text-xs font-semibold">
              {step}
            </div>
            <h2 className="text-sm font-medium">{title}</h2>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">{body}</p>
          </div>
        ))}
      </section>
    </div>
  );
}

function StatusCard({
  icon,
  title,
  value,
}: {
  icon: React.ReactNode;
  title: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-card p-3">
      <div className="mb-2 flex items-center gap-2 text-muted-foreground">
        {icon}
        <span className="text-xs font-medium uppercase">{title}</span>
      </div>
      <p className="text-sm leading-5 text-foreground">{value}</p>
    </div>
  );
}

