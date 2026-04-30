import { IntentForm } from "@/components/IntentForm";

export default function Home() {
  return (
    <div className="flex flex-col items-center justify-center min-h-full gap-8 w-full p-8">
      <div className="text-center space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Submit an Intent</h1>
        <p className="text-muted-foreground max-w-md">
          Sign a transaction intent with your wallet. The relayer batches and submits it
          to the on-chain registry for ERC-4337 bundler execution.
        </p>
      </div>
      <IntentForm />
    </div>
  );
}
