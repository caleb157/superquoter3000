// Traction board and Content tools: read the bullseye, add ideas and communities, plan and score content.
// Ring moves stay with Caleb in the app; no tool here moves a channel between rings.
import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { ok, withUserDb } from "../shared";
import {
  listContent, listTractionBoard, saveCommunity, saveContent, saveTractionIdea,
  type ListContentInput, type ListTractionInput, type SaveCommunityInput, type SaveContentInput, type SaveIdeaInput,
} from "../traction";
import { COMMUNITY_STATUSES, CONTENT_KINDS, CONTENT_STATUSES, IDEA_STATUSES, SLOT_STATUSES } from "../../sales/traction";

const write = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
const read = { readOnlyHint: true, idempotentHint: true, openWorldHint: false };
const json = (r: unknown) => r as Record<string, unknown>;
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const listTractionBoardTool = defineTool({
  name: "list_traction_board",
  title: "Read the Traction bullseye",
  description:
    "The 19 Traction channels with their ring (inner holds at most 3, the ones being tested now), each channel's top 5 open ideas, inquiries tagged to each channel, and the communities list with interaction plans. Read this before proposing channel work.",
  inputSchema: {
    channel_id: z.number().int().min(1).max(50).optional(),
    include_closed: z.boolean().optional().describe("Include done and dropped ideas."),
    community_status: z.enum(COMMUNITY_STATUSES).optional(),
  },
  annotations: read,
  handler: withUserDb(async (db, input: ListTractionInput) => {
    const r = await listTractionBoard(db, input);
    return ok(JSON.stringify(r), json(r));
  }),
});

export const saveTractionIdeaTool = defineTool({
  name: "save_traction_idea",
  title: "Add or update a Traction idea",
  description:
    "Add an idea to a channel (status proposed, or not for now when paid), or update one by id: rank, pitch, evidence, status, decision note. Ideas Caleb approves become tasks from the app. Never moves a channel's ring. Use dry_run first.",
  inputSchema: {
    id: z.string().uuid().optional(),
    channel_id: z.number().int().min(1).max(50).optional(),
    rank: z.number().int().min(1).max(100).optional(),
    title: z.string().max(300).optional(),
    pitch: z.string().max(4000).optional(),
    free_or_paid: z.enum(["free", "paid"]).optional(),
    hours_per_week: z.number().min(0).max(80).optional(),
    reach: z.string().max(500).optional(),
    soonest_inquiry: z.string().max(200).optional(),
    deadline: ymd.optional(),
    evidence: z.string().max(4000).optional(),
    status: z.enum(IDEA_STATUSES).optional(),
    decision_note: z.string().max(2000).optional(),
    dry_run: z.boolean().optional(),
  },
  annotations: write,
  handler: withUserDb(async (db, input: SaveIdeaInput) => {
    const r = await saveTractionIdea(db, input);
    const t = (r.idea as { title?: string }).title;
    return ok(`${r.dry_run ? "Dry run: would save" : r.created ? "Added" : "Updated"} idea "${t}".`, json(r));
  }),
});

export const saveCommunityTool = defineTool({
  name: "save_community",
  title: "Add or update a community",
  description:
    "Find a community (forum, group, newsletter, association) by name and update its status, interaction plan, who acts, last and next touch; or add it as a candidate. Use dry_run first.",
  inputSchema: {
    name: z.string().min(1).max(300),
    grp: z.string().max(100).optional(),
    audience: z.string().max(1000).optional(),
    cost: z.string().max(200).optional(),
    promotion_allowed: z.string().max(500).optional(),
    link: z.string().max(500).optional(),
    status: z.enum(COMMUNITY_STATUSES).optional(),
    priority: z.enum(["A", "B", "C", "X"]).optional(),
    high_value: z.boolean().optional(),
    interaction_plan: z.string().max(4000).optional(),
    who_acts: z.string().max(100).optional(),
    hours_per_month: z.number().min(0).max(200).optional(),
    last_touch: ymd.optional(),
    next_touch: ymd.optional(),
    notes: z.string().max(4000).optional(),
    dry_run: z.boolean().optional(),
  },
  annotations: write,
  handler: withUserDb(async (db, input: SaveCommunityInput) => {
    const r = await saveCommunity(db, input);
    return ok(`${r.dry_run ? "Dry run: would save" : r.created ? "Added" : "Updated"} ${input.name}.`, json(r));
  }),
});

export const listContentTool = defineTool({
  name: "list_content",
  title: "List content and the posting calendar",
  description: "Content pieces (posts, articles, case studies, charts, drips) and the posting calendar with scores, default 2 weeks back to 8 weeks ahead.",
  inputSchema: {
    status: z.enum(CONTENT_STATUSES).optional(),
    from: ymd.optional(),
    to: ymd.optional(),
    limit: z.number().int().min(1).max(500).optional(),
  },
  annotations: read,
  handler: withUserDb(async (db, input: ListContentInput) => {
    const r = await listContent(db, input);
    return ok(JSON.stringify(r), json(r));
  }),
});

export const saveContentTool = defineTool({
  name: "save_content",
  title: "Add or update a content piece",
  description:
    "Add a piece or update it by id or slug (body, status, proof, target search, cut-from parent), and add or update its calendar slots (one per channel and date) with variant, test and the 3-day score: qualified comments, profile views, accepts. Posts go on Caleb's profile only, through Buffer, after he approves. Use dry_run first.",
  inputSchema: {
    id: z.string().uuid().optional(),
    slug: z.string().max(120).optional(),
    title: z.string().max(300).optional(),
    kind: z.enum(CONTENT_KINDS).optional(),
    pillar: z.string().max(100).optional(),
    status: z.enum(CONTENT_STATUSES).optional(),
    body: z.string().max(20000).optional(),
    format_note: z.string().max(1000).optional(),
    proof: z.string().max(2000).optional(),
    target_search: z.string().max(300).optional(),
    parent_slug: z.string().max(120).optional().describe("The long piece this was cut from."),
    asset_url: z.string().max(1000).optional(),
    source: z.string().max(300).optional(),
    notes: z.string().max(4000).optional(),
    slots: z.array(z.object({
      slot_date: ymd,
      channel: z.enum(["linkedin", "website", "drip", "other"]).optional(),
      slot_time_ct: z.string().max(10).optional(),
      status: z.enum(SLOT_STATUSES).optional(),
      variant: z.string().max(20).optional(),
      test_id: z.string().max(100).optional(),
      post_url: z.string().max(1000).optional(),
      impressions: z.number().int().min(0).optional(),
      reactions: z.number().int().min(0).optional(),
      comments: z.number().int().min(0).optional(),
      qualified_comments: z.number().int().min(0).optional(),
      profile_views_3d: z.number().int().min(0).optional(),
      accepts_3d: z.number().int().min(0).optional(),
      notes: z.string().max(2000).optional(),
    })).max(20).optional(),
    dry_run: z.boolean().optional(),
  },
  annotations: write,
  handler: withUserDb(async (db, input) => {
    const r = await saveContent(db, input as SaveContentInput);
    const t = (r.piece as { title?: string }).title;
    return ok(`${r.dry_run ? "Dry run: would save" : r.created ? "Added" : "Updated"} "${t}"${r.slots.length ? ` and ${r.slots.length} calendar slot(s)` : ""}.`, json(r));
  }),
});

export const TRACTION_TOOLS = [listTractionBoardTool, saveTractionIdeaTool, saveCommunityTool, listContentTool, saveContentTool];
