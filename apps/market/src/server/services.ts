/**
 * Service Server Functions
 *
 * Type-safe server functions for D1 CRUD operations
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

// Validation schemas
const getServicesSchema = z.object({
  ownerAddress: z.string().min(32),
});

const createServiceSchema = z.object({
  name: z
    .string()
    .min(3)
    .max(32)
    .regex(/^[a-z0-9-]+$/),
  ownerAddress: z.string().min(32),
  splitConfig: z.string().min(32),
  splitVault: z.string().min(32),
  price: z.string().regex(/^\d+$/), // USDC base units
});

const updateServiceStatusSchema = z.object({
  id: z.string(),
  status: z.enum(["online", "offline"]),
});

// Types
export interface Service {
  id: string;
  name: string;
  owner_address: string;
  split_config: string;
  split_vault: string;
  price: string;
  status: string;
  tunnel_id: string | null;
  total_calls: number;
  total_revenue: string;
  pending_balance: string;
  created_at: string;
  last_connected_at: string | null;
  last_executed_at: string | null;
}

// Cloudflare env type
interface CloudflareEnv {
  DB: D1Database;
}

// Get env from cloudflare:workers
// Note: This import only works in Cloudflare Workers runtime
const getDb = async (): Promise<D1Database> => {
  // Dynamic import to avoid issues during build
  const { env } = await import("cloudflare:workers");
  return (env as CloudflareEnv).DB;
};

/**
 * Get all services for an owner
 */
export const getServices = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => getServicesSchema.parse(data))
  .handler(async (ctx) => {
    const { data } = ctx;
    const db = await getDb();
    const result = await db
      .prepare(
        "SELECT * FROM services WHERE owner_address = ? ORDER BY created_at DESC",
      )
      .bind(data.ownerAddress)
      .all<Service>();
    return result.results;
  });

/**
 * Get a single service by ID
 */
export const getService = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => z.object({ id: z.string() }).parse(data))
  .handler(async (ctx) => {
    const { data } = ctx;
    const db = await getDb();
    return db
      .prepare("SELECT * FROM services WHERE id = ?")
      .bind(data.id)
      .first<Service>();
  });

/**
 * Get a service by name (subdomain)
 */
export const getServiceByName = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => z.object({ name: z.string() }).parse(data))
  .handler(async (ctx) => {
    const { data } = ctx;
    const db = await getDb();
    return db
      .prepare("SELECT * FROM services WHERE name = ?")
      .bind(data.name)
      .first<Service>();
  });

/**
 * Check if a service name is available
 */
export const checkNameAvailable = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => z.object({ name: z.string() }).parse(data))
  .handler(async (ctx) => {
    const { data } = ctx;
    const db = await getDb();
    const existing = await db
      .prepare("SELECT id FROM services WHERE name = ?")
      .bind(data.name)
      .first();
    return { available: !existing };
  });

/**
 * Create a new service
 */
export const createService = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => createServiceSchema.parse(data))
  .handler(async (ctx) => {
    const { data } = ctx;
    const db = await getDb();
    const id = crypto.randomUUID();

    await db
      .prepare(
        `INSERT INTO services (id, name, owner_address, split_config, split_vault, price)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        data.name,
        data.ownerAddress,
        data.splitConfig,
        data.splitVault,
        data.price,
      )
      .run();

    return { id, ...data };
  });

/**
 * Update service status (online/offline)
 */
export const updateServiceStatus = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => updateServiceStatusSchema.parse(data))
  .handler(async (ctx) => {
    const { data } = ctx;
    const db = await getDb();
    const now = new Date().toISOString();

    await db
      .prepare(
        `UPDATE services SET status = ?, last_connected_at = ? WHERE id = ?`,
      )
      .bind(data.status, data.status === "online" ? now : null, data.id)
      .run();

    return { success: true };
  });

/**
 * Get service stats for dashboard
 */
export const getServiceStats = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) =>
    z.object({ ownerAddress: z.string() }).parse(data),
  )
  .handler(async (ctx) => {
    const { data } = ctx;
    const db = await getDb();

    const result = await db
      .prepare(
        `SELECT
          COUNT(*) as total_services,
          SUM(total_calls) as total_calls,
          SUM(CAST(total_revenue AS REAL)) as total_revenue,
          SUM(CAST(pending_balance AS REAL)) as pending_balance
         FROM services WHERE owner_address = ?`,
      )
      .bind(data.ownerAddress)
      .first<{
        total_services: number;
        total_calls: number;
        total_revenue: number;
        pending_balance: number;
      }>();

    return (
      result ?? {
        total_services: 0,
        total_calls: 0,
        total_revenue: 0,
        pending_balance: 0,
      }
    );
  });
