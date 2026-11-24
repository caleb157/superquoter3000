// Command center tools: the overview read, usage snapshots, schedule sync and email bounces.
import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { ok, withUserDb } from "../shared";
import {
  getSalesOverview, logUsage, markBounced, syncSchedules,
  type LogUsageInput, type MarkBouncedInput, type SyncSchedulesInput,
} from "../command-center";

const write = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
const json = (r: unknown) => r as Record<string, unknown>;

export const getSalesOverviewTool = defineTool({
  name: "get_sales_overview",
  title: "Sales command center",
  description:
    "The Sales Command center in numbers: this week's LinkedIn and email sends, bounces, replies, meetings, inquiries and customers against last week (same point and full week) and the targets; the funnel by stage now and a week ago; every scheduled run with its state, last report, last fire, next fire and credits; latest Claude and tool usage with the weekly pace; Caleb's tasks overdue, today and the next 7 days. Weeks start Monday 00:00 IST. Read-only.",
  inputSchema: { assignee: z.string().max(10).optional().describe("Tasks for this assignee code (default CQ).") },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: withUserDb(async (db, input: { assignee?: string }) => {
    const r = await getSalesOverview(db, input);
    return ok(JSON.stringify(r), json(r));
  }),
});

export const logUsageTool = defineTool({
  name: "log_usage",
  title: "Log usage readings",
  description:
    "Log Claude plan use (source claude: weekly_pct, session_pct, with resets_at and plan) or a tool's balance (firecrawl, reoon, waalaxy, apollo: credits_left, credits_used) so the Command center can show usage over time for the Pro vs Max call. Readings share one taken_at. Use dry_run first.",
  inputSchema: {
    readings: z.array(z.object({
      source: z.string().min(1).max(50),
      metric: z.string().min(1).max(50),
      value: z.number(),
      unit: z.string().max(20).optional().describe("pct, credits or usd."),
      resets_at: z.string().optional(),
      plan: z.string().max(50).optional(),
      note: z.string().max(500).optional(),
    })).min(1).max(50),
    taken_at: z.string().optional().describe("ISO date-time the readings were taken. Default now."),
    logged_by: z.string().max(100).optional(),
    dry_run: z.boolean().optional(),
  },
  annotations: write,
  handler: withUserDb(async (db, input: LogUsageInput) => {
    const r = await logUsage(db, input);
    return ok(`${r.dry_run ? "Dry run: would log" : "Logged"} ${r.rows.length} reading${r.rows.length === 1 ? "" : "s"}.`, json(r));
  }),
});

export const syncSchedulesTool = defineTool({
  name: "sync_schedules",
  title: "Sync the run board",
  description:
    "Bring the Command center's run board in line with the scheduled tasks: for each run (by id) its last fire time and status, next fire, and any change to its cadence, cron (IST), budget or status. A new id needs job, name and cadence. Never deletes; set status retired instead. Use dry_run first.",
  inputSchema: {
    schedules: z.array(z.object({
      id: z.string().min(1).max(100),
      job: z.string().max(100).optional(),
      name: z.string().max(200).optional(),
      cadence: z.string().max(200).optional(),
      cron: z.string().max(200).nullable().optional(),
      runs_where: z.string().max(100).optional(),
      what_it_does: z.string().max(1000).optional(),
      status: z.enum(["live", "paused", "planned", "retired"]).optional(),
      run_once_at: z.string().nullable().optional(),
      credit_budget: z.string().max(200).nullable().optional(),
      last_fired_at: z.string().nullable().optional(),
      last_fire_status: z.string().max(50).nullable().optional(),
      next_run_at: z.string().nullable().optional(),
      note: z.string().max(500).nullable().optional(),
    })).min(1).max(100),
    dry_run: z.boolean().optional(),
  },
  annotations: write,
  handler: withUserDb(async (db, input: SyncSchedulesInput) => {
    const r = await syncSchedules(db, input);
    return ok(`${r.dry_run ? "Dry run: would add" : "Added"} ${r.added.length}, ${r.dry_run ? "update" : "updated"} ${r.updated.length}.`, json(r));
  }),
});

export const markBouncedTool = defineTool({
  name: "mark_bounced",
  title: "Mark an email bounced",
  description:
    "Mark the latest outbound email to an address (or one email touch by external_id) as bounced, for the Command center's bounce rate (the email ramp holds while bounces stay under 2%). A hard bounce (default) also sets never-email on the contact. Use dry_run first.",
  inputSchema: {
    email: z.string().max(320).optional(),
    touch_external_id: z.string().max(300).optional(),
    bounced_at: z.string().optional(),
    hard: z.boolean().optional().describe("Default true. A soft bounce only marks the touch."),
    dry_run: z.boolean().optional(),
  },
  annotations: write,
  handler: withUserDb(async (db, input: MarkBouncedInput) => {
    const r = await markBounced(db, input);
    return ok(`${r.dry_run ? "Dry run: would mark" : "Marked"} the email${r.contact ? ` to ${r.contact}` : ""} bounced${r.sets_never_email ? " and set never-email" : ""}.`, json(r));
  }),
});

export const COMMAND_CENTER_TOOLS = [getSalesOverviewTool, logUsageTool, syncSchedulesTool, markBouncedTool];
