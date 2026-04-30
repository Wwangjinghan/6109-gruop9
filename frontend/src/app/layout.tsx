import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import { Providers } from "./providers";
import { WalletConnector } from "@/components/WalletConnector";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "AgentIntent Protocol",
  description: "Submit signed intents to the on-chain registry via the relayer",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <Providers>
          <header className="border-b px-6 py-4 flex items-center justify-between">
            <div className="flex items-center gap-6">
              <span className="font-semibold tracking-tight">AgentIntent Protocol</span>
              <nav className="flex items-center gap-4 text-sm text-muted-foreground">
                <Link href="/" className="hover:text-foreground transition-colors">Submit</Link>
                <Link href="/dashboard" className="hover:text-foreground transition-colors">Dashboard</Link>
              </nav>
            </div>
            <WalletConnector />
          </header>
          <main className="min-h-[calc(100vh-65px)]">
            {children}
          </main>
        </Providers>
      </body>
    </html>
  );
}
