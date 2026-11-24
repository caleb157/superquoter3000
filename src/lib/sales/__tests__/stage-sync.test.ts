import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ALL_SALES_STAGES, CUSTOMER_GROUPS, LEAD_STATUS_FROM_STAGE, STAGE_FROM_LEAD_STATUS, stageAfterTouch, stageFromLeadStatus,
} from "../sales-core";
import { isBackfill } from "../command-center";

const sql = readFileSync(resolve(__dirname, "../../../../supabase/migrations/20261124210000_unify_stage_lead_status.sql"), "utf8");

/** Pulls the WHEN 'a' THEN 'b' pairs out of one SQL map function. */
function sqlMap(fn: string): Record<string, string> {
  const start = sql.indexOf(`FUNCTION public.${fn}(`);
  const body = sql.slice(start, sql.indexOf("$$;", start));
  return Object.fromEntries([...body.matchAll(/WHEN '(\w+)' THEN '(\w+)'/g)].map(m => [m[1], m[2]]));
}

describe("one status per customer", () => {
  it("the app and the database map stage to lead status the same way", () => {
    expect(sqlMap("lead_status_from_sales_stage")).toEqual(LEAD_STATUS_FROM_STAGE);
    expect(sqlMap("sales_stage_from_lead_status")).toEqual(STAGE_FROM_LEAD_STATUS);
  });

  it("covers every stage, and every old lead status lands on a stage", () => {
    expect(Object.keys(LEAD_STATUS_FROM_STAGE).sort()).toEqual([...ALL_SALES_STAGES].sort());
    for (const s of ["prospect", "lead", "active", "won", "inactive", "churned"]) expect(ALL_SALES_STAGES).toContain(stageFromLeadStatus(s));
    expect(stageFromLeadStatus("Won")).toBe("customer");
    expect(stageFromLeadStatus(null)).toBe("responded");
  });

  it("puts each stage in exactly one Customers tab", () => {
    const all = CUSTOMER_GROUPS.flatMap(g => [...g.stages]);
    expect(all.sort()).toEqual([...ALL_SALES_STAGES].sort());
  });

  it("moves stages on a logged message the same way everywhere", () => {
    expect(stageAfterTouch("queued", "out")).toBe("in_outreach");
    expect(stageAfterTouch("in_outreach", "out")).toBeNull();
    expect(stageAfterTouch("in_outreach", "in", true)).toBe("responded");
    expect(stageAfterTouch("not_now", "in")).toBe("responded");
    expect(stageAfterTouch("responded", "in")).toBeNull();
    expect(stageAfterTouch("responded", "in", true)).toBe("in_conversation");
    for (const s of ["inquiry", "customer", "not_a_fit", "dnc"]) {
      expect(stageAfterTouch(s, "in", true)).toBeNull();
      expect(stageAfterTouch(s, "out")).toBeNull();
    }
  });

  it("keeps the one-off clean-up out of the Command center's weekly movement", () => {
    expect(isBackfill({ actor: "stage-sync (lead status merge)" })).toBe(true);
  });
});
