/**
 * Demo Panel - Notebook-style terminal with tabs
 *
 * Interactive demo showing tabsFetch SDK in action.
 * Tabs for Demo, TypeScript, and cURL code snippets.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { Play, Copy, Check, RotateCcw } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Inline copy hook
function useCopyToClipboard(timeout = 2000) {
  const [isCopied, setIsCopied] = useState(false);
  const copyToClipboard = useCallback(
    (value: string) => {
      navigator.clipboard.writeText(value).then(() => {
        setIsCopied(true);
        setTimeout(() => setIsCopied(false), timeout);
      }, console.error);
    },
    [timeout],
  );
  return { isCopied, copyToClipboard };
}

// =============================================================================
// Types
// =============================================================================

interface DemoPanelProps {
  apiKey: string | null;
  hasSpendingLimit: boolean;
}

type DemoState = "idle" | "running" | "complete" | "error";
type PanelTab = "demo" | "typescript" | "curl";

interface TerminalLink {
  text: string;
  url: string;
}

interface TerminalLine {
  id: number;
  type:
    | "import"
    | "variable"
    | "command"
    | "status"
    | "success"
    | "error"
    | "blank";
  content: string;
  link?: TerminalLink;
}

// =============================================================================
// Constants
// =============================================================================

const DEMO_ENDPOINT = "/api/echo/resource";
const SETTLE_ENDPOINT = "/api/settle";
const STATUS_DELAY = 350; // ms between status lines
const SOLSCAN_BASE = "https://solscan.io";

// Truncate string in the middle for display
function truncateMiddle(str: string, maxLen = 24): string {
  if (str.length <= maxLen) return str;
  const half = Math.floor((maxLen - 3) / 2);
  return `${str.slice(0, half)}...${str.slice(-half)}`;
}

// =============================================================================
// Component
// =============================================================================

export function DemoPanel({ apiKey, hasSpendingLimit }: DemoPanelProps) {
  const [activeTab, setActiveTab] = useState<PanelTab>("demo");
  const [state, setState] = useState<DemoState>("idle");
  const [lines, setLines] = useState<TerminalLine[]>([]);
  const terminalRef = useRef<HTMLDivElement>(null);
  const { isCopied, copyToClipboard } = useCopyToClipboard();
  const lineIdRef = useRef(0);

  const isDisabled = !hasSpendingLimit || !apiKey;

  // Auto-scroll terminal when lines change
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll trigger on lines change
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [lines.length]);

  const addLine = (
    type: TerminalLine["type"],
    content: string,
    options?: { delay?: number; link?: TerminalLink },
  ): Promise<void> => {
    const delay = options?.delay ?? STATUS_DELAY;
    return new Promise((resolve) => {
      const id = ++lineIdRef.current;
      setLines((prev) => [...prev, { id, type, content, link: options?.link }]);
      setTimeout(resolve, delay);
    });
  };

  const runDemo = async () => {
    if (!apiKey || state === "running") return;

    setState("running");
    setLines([]);
    lineIdRef.current = 0;

    try {
      // Step 1: Initial request (code is already shown statically above)
      await addLine("status", "  → GET /api/echo/resource", { delay: 200 });

      const res = await fetch(DEMO_ENDPOINT);
      if (res.status !== 402) {
        throw new Error(`Expected 402, got ${res.status}`);
      }

      const paymentInfo = (await res.json()) as {
        accepts: Array<{
          payTo: string;
          maxAmountRequired: string;
        }>;
      };

      const accept = paymentInfo.accepts[0];
      if (!accept) throw new Error("No payment options");

      await addLine(
        "status",
        `  → 402 Payment Required — 0.01 USDC to ${truncateMiddle(accept.payTo, 16)}`,
        {
          link: {
            text: truncateMiddle(accept.payTo, 16),
            url: `${SOLSCAN_BASE}/account/${accept.payTo}`,
          },
        },
      );

      // Step 2: Settlement
      await addLine("status", "  → Signing via Tabs facilitator...");

      const settleRes = await fetch(SETTLE_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey,
          payTo: accept.payTo,
          amount: accept.maxAmountRequired,
        }),
      });

      const settleData = (await settleRes.json()) as {
        success: boolean;
        transaction?: string;
        error?: string;
      };

      if (!settleData.success || !settleData.transaction) {
        throw new Error(settleData.error || "Settlement failed");
      }

      await addLine(
        "status",
        "  → Transaction signed, submitting to Solana...",
      );

      // Step 3: Retry with payment
      const payload = btoa(
        JSON.stringify({
          x402Version: 1,
          scheme: "exact",
          network: "solana",
          payload: {
            transaction: settleData.transaction,
            tabsApiKey: apiKey,
          },
        }),
      );

      const finalRes = await fetch(DEMO_ENDPOINT, {
        headers: { "X-PAYMENT": payload },
      });

      const finalData = (await finalRes.json()) as {
        success?: boolean;
        message?: string;
        data?: {
          paymentSignature?: string;
          refundSignature?: string;
        };
      };

      // Show payment signature with link
      if (finalData.data?.paymentSignature) {
        const sig = finalData.data.paymentSignature;
        await addLine("status", `  → Tx ${truncateMiddle(sig, 16)} confirmed`, {
          link: {
            text: truncateMiddle(sig, 16),
            url: `${SOLSCAN_BASE}/tx/${sig}`,
          },
        });
      }

      // Combined 200 OK with response
      const responseStr = JSON.stringify({
        success: finalData.success,
        message: finalData.message,
      });
      await addLine("success", `  → 200 OK ${responseStr}`);

      setState("complete");
    } catch (err) {
      await addLine(
        "error",
        `  ✗ ${err instanceof Error ? err.message : "Demo failed"}`,
      );
      setState("error");
    }
  };

  const resetDemo = () => {
    setState("idle");
    setLines([]);
  };

  const getSessionText = (): string => {
    return lines
      .filter((l) => l.type !== "blank")
      .map((l) => l.content)
      .join("\n");
  };

  const displayApiKey = truncateMiddle(apiKey || "", 24);

  const snippets: Record<"typescript" | "curl", string> = {
    typescript: `import { tabsFetch } from '@cascade-fyi/tabs-sdk'

const apiKey = '${displayApiKey}';

await tabsFetch("/api/echo/resource", { apiKey })`,
    curl: `# Step 1: Make request (returns 402)
curl -i https://api.example.com/resource

# Step 2: Settle via Tabs
curl -X POST https://tabs.cascade.fyi/api/settle \\
  -H 'Content-Type: application/json' \\
  -d '{"apiKey": "${displayApiKey}", "payTo": "...", "amount": "..."}'

# Step 3: Retry with payment
curl https://api.example.com/resource \\
  -H 'X-PAYMENT: <base64_payload>'`,
  };

  return (
    <div className={cn("space-y-3", isDisabled && "opacity-60")}>
      {/* Terminal Window */}
      <div className="rounded-lg border border-border bg-background overflow-hidden">
        {/* Combined Title Bar + Tabs */}
        <div className="flex items-center justify-between px-3 py-2 bg-muted/50 border-b border-border">
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5">
              <div className="size-2.5 rounded-full bg-muted-foreground/40" />
              <div className="size-2.5 rounded-full bg-muted-foreground/40" />
              <div className="size-2.5 rounded-full bg-muted-foreground/40" />
            </div>
            <span className="text-[11px] font-medium text-muted-foreground ml-1">
              cascade-tabs
            </span>
          </div>
          <div className="flex gap-1">
            {(["demo", "typescript", "curl"] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={cn(
                  "px-2 py-1 text-[11px] font-medium rounded transition-colors",
                  activeTab === tab
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {tab === "demo"
                  ? "Demo"
                  : tab === "typescript"
                    ? "TypeScript"
                    : "cURL"}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div
          ref={terminalRef}
          className={cn(
            "p-3 font-mono text-[13px] leading-relaxed min-h-[160px] max-h-[260px] overflow-y-auto break-all",
            isDisabled && "pointer-events-none",
          )}
        >
          {activeTab === "demo" ? (
            <>
              {/* Static code preview - always visible */}
              <div className="text-muted-foreground">
                {"import { tabsFetch } from '@cascade-fyi/tabs-sdk'"}
              </div>
              <div className="h-4" />
              <div className="text-muted-foreground">
                {"const apiKey = '"}
                <button
                  type="button"
                  onClick={() => {
                    if (apiKey) {
                      navigator.clipboard.writeText(apiKey);
                      toast.success("API key copied");
                    }
                  }}
                  className="text-amber-400 hover:text-amber-300 cursor-pointer"
                  title="Click to copy full API key"
                >
                  {truncateMiddle(apiKey || "", 24)}
                </button>
                {"';"}
              </div>
              <div className="h-4" />
              <div className="text-emerald-400">
                {'await tabsFetch("/api/echo/resource", { apiKey })'}
              </div>

              {/* Dynamic lines from demo execution */}
              {lines.map((line) => (
                <TerminalLineComponent key={line.id} line={line} />
              ))}
            </>
          ) : activeTab === "typescript" ? (
            <TypeScriptSnippet apiKey={apiKey} />
          ) : (
            <CurlSnippet apiKey={apiKey} />
          )}
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex items-center gap-2">
        {activeTab === "demo" ? (
          <>
            {state === "idle" ? (
              <Button
                onClick={runDemo}
                disabled={isDisabled}
                size="sm"
                className="flex-1"
              >
                <Play className="size-4" />
                Run Demo
              </Button>
            ) : state === "running" ? (
              <Button disabled size="sm" variant="secondary" className="flex-1">
                <span className="inline-block w-2 h-2 mr-2 bg-emerald-400 rounded-full animate-pulse" />
                Running...
              </Button>
            ) : (
              <Button
                onClick={resetDemo}
                variant="outline"
                size="sm"
                className="flex-1"
              >
                <RotateCcw className="size-4" />
                Run Again
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => copyToClipboard(getSessionText())}
              disabled={lines.length === 0}
              title="Copy session"
            >
              {isCopied ? (
                <Check className="size-4 text-green-500" />
              ) : (
                <Copy className="size-4" />
              )}
            </Button>
          </>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={() => copyToClipboard(snippets[activeTab])}
            className="flex-1"
          >
            {isCopied ? (
              <>
                <Check className="size-4 text-green-500" />
                Copied!
              </>
            ) : (
              <>
                <Copy className="size-4" />
                Copy Code
              </>
            )}
          </Button>
        )}
      </div>

      {/* Disabled message */}
      {isDisabled && (
        <p className="text-center text-sm text-muted-foreground">
          Set a spending limit to try the demo
        </p>
      )}
    </div>
  );
}

// =============================================================================
// Terminal Line Component
// =============================================================================

function TerminalLineComponent({ line }: { line: TerminalLine }) {
  if (line.type === "blank") {
    return <div className="h-4" />;
  }

  const colorClass = {
    import: "text-muted-foreground",
    variable: "text-muted-foreground",
    command: "text-emerald-400",
    status: "text-muted-foreground",
    success: "text-emerald-400",
    error: "text-destructive",
  }[line.type];

  // If there's a link, replace the link text with an anchor
  if (line.link) {
    const { text, url } = line.link;
    const parts = line.content.split(text);
    return (
      <div className={colorClass}>
        {parts[0]}
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary hover:text-primary/80 underline underline-offset-2"
        >
          {text}
        </a>
        {parts.slice(1).join(text)}
      </div>
    );
  }

  return <div className={colorClass}>{line.content}</div>;
}

// =============================================================================
// Styled Snippet Components
// =============================================================================

function TypeScriptSnippet({ apiKey }: { apiKey: string | null }) {
  const displayKey = truncateMiddle(apiKey || "", 24);

  const copyApiKey = () => {
    if (apiKey) {
      navigator.clipboard.writeText(apiKey);
      toast.success("API key copied");
    }
  };

  return (
    <>
      <div className="text-muted-foreground">
        {"import { tabsFetch } from "}
        <span className="text-amber-400">"@cascade-fyi/tabs-sdk"</span>
      </div>
      <div className="h-4" />
      <div className="text-muted-foreground">
        {"const apiKey = '"}
        <button
          type="button"
          onClick={copyApiKey}
          className="text-amber-400 hover:text-amber-300 cursor-pointer"
          title="Click to copy full API key"
        >
          {displayKey}
        </button>
        {"';"}
      </div>
      <div className="h-4" />
      <div className="text-emerald-400">
        {"await tabsFetch("}
        <span className="text-amber-400">"/api/echo/resource"</span>
        {", { apiKey })"}
      </div>
    </>
  );
}

function CurlSnippet({ apiKey }: { apiKey: string | null }) {
  const displayKey = truncateMiddle(apiKey || "", 24);

  const copyApiKey = () => {
    if (apiKey) {
      navigator.clipboard.writeText(apiKey);
      toast.success("API key copied");
    }
  };

  return (
    <>
      <div className="text-muted-foreground/60">
        # Step 1: Make request (returns 402)
      </div>
      <div className="text-foreground/90">
        <span className="text-emerald-400">curl</span>
        {" -i https://api.example.com/resource"}
      </div>
      <div className="h-4" />
      <div className="text-muted-foreground/60"># Step 2: Settle via Tabs</div>
      <div className="text-foreground/90">
        <span className="text-emerald-400">curl</span>
        {" -X POST https://tabs.cascade.fyi/api/settle \\"}
      </div>
      <div className="text-foreground/90 pl-4">
        {"-H "}
        <span className="text-amber-400">'Content-Type: application/json'</span>
        {" \\"}
      </div>
      <div className="text-foreground/90 pl-4">
        {'-d \'{"apiKey": "'}
        <button
          type="button"
          onClick={copyApiKey}
          className="text-amber-400 hover:text-amber-300 cursor-pointer"
          title="Click to copy full API key"
        >
          {displayKey}
        </button>
        {'", "payTo": "...", "amount": "..."}\''}
      </div>
      <div className="h-4" />
      <div className="text-muted-foreground/60">
        # Step 3: Retry with payment
      </div>
      <div className="text-foreground/90">
        <span className="text-emerald-400">curl</span>
        {" https://api.example.com/resource \\"}
      </div>
      <div className="text-foreground/90 pl-4">
        {"-H "}
        <span className="text-amber-400">
          'X-PAYMENT: {"<base64_payload>"}'
        </span>
      </div>
    </>
  );
}
