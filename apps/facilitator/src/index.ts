/**
 * Cascade Facilitator
 *
 * x402 facilitator implementing RFC #646 enhancements:
 * - CPI verification via simulation (smart wallet support)
 * - Deadline validator support (maxTimeoutSeconds enforcement)
 * - Durable nonce support (extended timeouts)
 *
 * @see https://github.com/coinbase/x402/issues/646
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env } from "./types.js";
import { supportedHandler } from "./routes/supported.js";
import { verifyHandler } from "./routes/verify.js";
import { settleHandler } from "./routes/settle.js";

const app = new Hono<{ Bindings: Env }>();

// CORS for all routes
app.use("/*", cors());

// Health check
app.get("/health", (c) => c.json({ ok: true, timestamp: Date.now() }));

// x402 Facilitator endpoints
app.get("/supported", supportedHandler);
app.post("/verify", verifyHandler);
app.post("/settle", settleHandler);

export default app;
