// Shared helpers for the PD HQ connector tools.
// Imports here must be relative or npm packages: the connector bundler turns any other bare
// specifier (including the app's "@/..." alias) into an npm: import, which would not resolve.
import { createClient } from "@supabase/supabase-js";
import type { ToolContext } from "@lovable.dev/mcp-js";

/** A Supabase client. Typed loosely so tests can pass an in-memory stand-in. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = any;

/** Read an environment variable in the edge function (Deno) or under Node (tests, manifest extraction). */
export function readEnv(name: string): string | undefined {
  const g = globalThis as { Deno?: { env?: { get(k: string): string | undefined } }; process?: { env?: Record<string, string | undefined> } };
  try {
    const v = g.Deno?.env?.get(name);
    if (v) return v;
  } catch {
    // Deno without env permission: fall through to process.env.
  }
  return g.process?.env?.[name] || undefined;
}

/**
 * Supabase client that acts as the signed-in user, so Row-Level Security applies to every query.
 * Supabase sets SUPABASE_ANON_KEY in edge functions; SUPABASE_PUBLISHABLE_KEY is accepted first
 * for projects that use the newer key name. Read inside handlers only, never at module load.
 */
export function supabaseForUser(ctx: ToolContext): Db {
  const url = readEnv("SUPABASE_URL");
  const key = readEnv("SUPABASE_PUBLISHABLE_KEY") ?? readEnv("SUPABASE_ANON_KEY");
  if (!url || !key) {
    throw new Error(
      `PD HQ connector is missing ${!url ? "SUPABASE_URL" : "SUPABASE_PUBLISHABLE_KEY or SUPABASE_ANON_KEY"} in the edge function environment.`,
    );
  }
  return createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${ctx.getToken()}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export type ToolResult = {
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

export const ok = (text: string, structuredContent?: Record<string, unknown>): ToolResult =>
  ({ content: [{ type: "text", text }], ...(structuredContent ? { structuredContent } : {}) });

export const fail = (text: string): ToolResult => ({ content: [{ type: "text", text }], isError: true });

/** Thrown by tool logic for a problem the caller can fix (bad id, duplicate, missing field). */
export class ToolError extends Error {}

/**
 * Wrap a tool handler: refuse unauthenticated calls, build the user's client, and turn any thrown
 * error into a readable tool error instead of a bare "tool execution failed".
 */
export function withUserDb<I>(run: (db: Db, input: I, ctx: ToolContext) => Promise<ToolResult>) {
  return async (input: I, ctx: ToolContext): Promise<ToolResult> => {
    if (!ctx.isAuthenticated()) return fail("Not authenticated");
    try {
      return await run(supabaseForUser(ctx), input, ctx);
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e));
    }
  };
}

/** Throw a ToolError when a Supabase response carries an error. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function check(res: { data: any; error: { message: string } | null }, what: string): any {
  if (res.error) throw new ToolError(`${what}: ${res.error.message}`);
  return res.data;
}

/** Strip characters that would break a PostgREST filter string or act as LIKE wildcards. */
export const cleanSearch = (s: string) => s.trim().replace(/[%,()*\\]/g, " ").replace(/\s+/g, " ").trim();

export const YMD = /^\d{4}-\d{2}-\d{2}$/;
export function isValidYmd(v: string): boolean {
  if (!YMD.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/** Today's date in India, the same day the database uses for task defaults. */
export function todayInIndia(now = new Date()): string {
  return new Date(now.getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}
