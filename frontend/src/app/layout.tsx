import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { Providers } from "./providers";
import { WalletConnector } from "@/components/WalletConnector";

export const metadata: Metadata = {
  title: "AgentIntent Protocol",
  description: "Submit signed intents to the on-chain registry via the relayer",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <header className="border-b border-border/60 px-6 h-14 flex items-center justify-between sticky top-0 z-50 bg-background/95 backdrop-blur-sm">
            <div className="flex items-center gap-8">
              <span className="font-semibold tracking-tight text-sm text-foreground">
                AgentIntent
              </span>
              <nav className="flex items-center gap-6">
                <Link
                  href="/"
                  className="text-sm text-muted-foreground hover:text-foreground transition-colors duration-150"
                >
                  Submit
                </Link>
                <Link
                  href="/dashboard"
                  className="text-sm text-muted-foreground hover:text-foreground transition-colors duration-150"
                >
                  Dashboard
                </Link>
              </nav>
            </div>
            <WalletConnector />
          </header>
          <main className="min-h-[calc(100vh-56px)]">
            {children}
          </main>
        </Providers>
      </body>
    </html>
  );
}
