import { IntentForm } from "@/components/IntentForm";

export default function Home() {
  return (
    <div className="flex flex-col items-center justify-start min-h-full pt-16 pb-16 px-4">
      <div className="w-full max-w-lg space-y-8">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold tracking-tight">Submit Intent</h1>
          <p className="text-sm text-muted-foreground">
            Sign an intent off-chain. The relayer batches and submits it via ERC-4337.
          </p>
        </div>
        <IntentForm />
      </div>
    </div>
  );
}
