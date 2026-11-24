// Needs you tools: the list as the Sales page shows it, and Done / Ignore / Undo.
import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { ok, withUserDb } from "../shared";
import { dismissNeedsYou, listNeedsYou, type DismissNeedsYouInput, type ListNeedsYouInput } from "../needs-you";

const json = (r: unknown) => r as Record<string, unknown>;

export const listNeedsYouTool = defineTool({
  name: "list_needs_you",
  title: "List Needs you",
  description:
    "The Sales page's Needs you list, in its order: forgotten conversations, qualified accounts, nudges, drafted replies, due tasks, warm accounts with nothing planned, accounts back from Not now. Items Caleb marked Done or Ignored are left out until a new inbound message arrives, the Ignore date comes or he undoes it; include_hidden lists them too. The watchdog reads this before adding anything. Read-only.",
  inputSchema: {
    include_hidden: z.boolean().optional().describe("Also list the items Done or Ignore is holding back."),
    kind: z.enum(["forgotten", "qualified", "nudge", "draft", "task", "quiet", "back"]).optional(),
    limit: z.number().int().min(1).max(500).optional().describe("Max items (default 200)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: withUserDb(async (db, input: ListNeedsYouInput) => {
    const r = await listNeedsYou(db, input);
    return ok(JSON.stringify(r), json(r));
  }),
});

export const dismissNeedsYouTool = defineTool({
  name: "dismiss_needs_you",
  title: "Mark a Needs you item done or ignored",
  description:
    "Done: handled (optionally with a note); it stays off Needs you until a new inbound message comes in, and a task item is closed. Ignore: off Needs you for ignore_days or until a date, or forever (until a new inbound message). Undo: puts the newest one back (and reopens a task Done closed). Name the item as forgotten, qualified, quiet or back for account items, or task_id for a follow-up or due task. Jobs use this only when Caleb asked. Use dry_run first.",
  inputSchema: {
    customer_id: z.string().uuid(),
    item: z.enum(["forgotten", "qualified", "quiet", "back", "task"]).optional(),
    task_id: z.string().uuid().optional(),
    action: z.enum(["done", "ignore", "undo"]),
    note: z.string().max(2000).optional(),
    ignore_days: z.number().int().min(1).max(3650).optional().describe("Ignore only. Leave out (and until) for forever."),
    until: z.string().optional().describe("Ignore only: YYYY-MM-DD it may show again."),
    dismissal_id: z.string().uuid().optional().describe("Undo this one instead of the newest for the item."),
    actor: z.string().max(100).optional().describe("Who asked, e.g. caleb-via-chat."),
    dry_run: z.boolean().optional(),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  handler: withUserDb(async (db, input: DismissNeedsYouInput) => {
    const r = await dismissNeedsYou(db, input);
    const verb = input.action === "undo" ? "Put back" : input.action === "done" ? "Marked done" : "Ignored";
    return ok(`${r.dry_run ? "Dry run: " : ""}${verb}.`, json(r));
  }),
});

export const NEEDS_YOU_TOOLS = [listNeedsYouTool, dismissNeedsYouTool];
