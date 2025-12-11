import { Link } from "@tanstack/react-router";
import { useWalletConnection } from "@solana/react-hooks";
import { Terminal, Server, DollarSign, Wallet, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function About() {
  const { connect, connectors, connecting, connected } = useWalletConnection();

  return (
    <main className="flex flex-1 flex-col items-center justify-center px-4 py-12 md:py-16">
      <div className="w-full max-w-2xl space-y-10">
        {/* Hero */}
        <div className="text-center space-y-3">
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight">
            Monetize your MCP in one command
          </h1>
          <p className="text-lg text-muted-foreground">
            Public endpoint. Automatic revenue. No infrastructure.
          </p>
        </div>

        {/* Code Block - static, tabs style colors */}
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 bg-muted/50 border-b border-border">
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5">
                <div className="size-2.5 rounded-full bg-muted-foreground/40" />
                <div className="size-2.5 rounded-full bg-muted-foreground/40" />
                <div className="size-2.5 rounded-full bg-muted-foreground/40" />
              </div>
              <span className="text-[11px] font-medium text-muted-foreground ml-1">
                terminal
              </span>
            </div>
          </div>
          <div className="p-4 font-mono text-sm leading-relaxed">
            <div className="text-muted-foreground">
              $ cascade --token{" "}
              <span className="text-amber-500 dark:text-amber-400">
                csc_xxx
              </span>{" "}
              localhost:3000
            </div>
            <div className="h-3" />
            <div className="text-muted-foreground">
              ✓ Authenticated:{" "}
              <span className="text-foreground">twitter-research</span>
            </div>
            <div className="text-muted-foreground">
              ✓ Split: <span className="text-foreground">7xK9...3mP</span>
              {" → "}
              <span className="text-foreground">your-wallet.sol</span>
            </div>
            <div className="text-muted-foreground">
              ✓ Price: <span className="text-foreground">$0.001/call</span>
            </div>
            <div className="text-muted-foreground">
              ✓ Live at:{" "}
              <span className="text-amber-500 dark:text-amber-400">
                https://twitter-research.mcps.cascade.fyi
              </span>
            </div>
          </div>
        </div>

        {/* Value Props - compact 3-column grid like tabs */}
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="flex flex-col gap-2 p-4 rounded-lg border border-border bg-card">
            <Terminal className="h-5 w-5 text-primary" />
            <h3 className="font-semibold">One command</h3>
            <p className="text-sm text-muted-foreground">
              Run the CLI to tunnel your local MCP to a public endpoint.
            </p>
          </div>

          <div className="flex flex-col gap-2 p-4 rounded-lg border border-border bg-card">
            <Server className="h-5 w-5 text-primary" />
            <h3 className="font-semibold">Public endpoint</h3>
            <p className="text-sm text-muted-foreground">
              Get a URL anyone can use. No servers to manage.
            </p>
          </div>

          <div className="flex flex-col gap-2 p-4 rounded-lg border border-border bg-card">
            <DollarSign className="h-5 w-5 text-primary" />
            <h3 className="font-semibold">Automatic revenue</h3>
            <p className="text-sm text-muted-foreground">
              Payments split directly to your wallet via Cascade Splits.
            </p>
          </div>
        </div>

        {/* CTA */}
        <div className="text-center space-y-4">
          {connected ? (
            <Button size="lg" asChild>
              <Link to="/">
                <ArrowRight className="h-4 w-4" />
                Go to Dashboard
              </Link>
            </Button>
          ) : (
            <>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="lg" disabled={connecting}>
                    <Wallet className="h-4 w-4" />
                    {connecting ? "Connecting..." : "Get Started"}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="center">
                  {connectors.map((connector) => (
                    <DropdownMenuItem
                      key={connector.id}
                      onClick={() => connect(connector.id)}
                    >
                      {connector.icon && (
                        <img
                          src={connector.icon}
                          alt={connector.name}
                          className="h-4 w-4"
                        />
                      )}
                      {connector.name}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <p className="text-sm text-muted-foreground">
                Powered by{" "}
                <a
                  href="https://github.com/cascade-protocol/splits"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-foreground hover:underline"
                >
                  Cascade Splits
                </a>
              </p>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
