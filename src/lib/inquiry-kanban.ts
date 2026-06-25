// Kanban column derivation for the Dashboard inquiry board.

import type { InquiryStatus } from '@/lib/inquiry-status';

export type KanbanColumn =
  | 'Idea' | 'Costing' | 'Quoted' | 'Sampling'
  | 'Paused' | 'Projected PO' | 'PO' | 'Complete' | 'Cancelled';

export const ACTIVE_SUBSTAGES: KanbanColumn[] = ['Idea', 'Costing', 'Quoted', 'Sampling'];
export const SUBSTAGE_ORDER: Record<string, number> = { Idea: 0, Costing: 1, Quoted: 2, Sampling: 3 };

export const KANBAN_SUBSTAGE_LABEL: Record<string, KanbanColumn> = {
  idea: 'Idea', costing: 'Costing', quoted: 'Quoted', sampling: 'Sampling',
};
export const KANBAN_LABEL_TO_OVERRIDE: Record<string, string> = {
  Idea: 'idea', Costing: 'costing', Quoted: 'quoted', Sampling: 'sampling',
};

export const KANBAN_COL_TO_STATUS: Record<string, InquiryStatus> = {
  Paused: 'paused',
  'Projected PO': 'projected_po',
  PO: 'po',
  Complete: 'complete',
  Cancelled: 'cancelled',
};

export type KanbanProduct = {
  design_stage: string | null;
  quote_stage: string | null;
  sample_stage: string | null;
  cbm_done?: boolean | null;
  cogs_done?: boolean | null;
  overhead_done?: boolean | null;
  shipping_done?: boolean | null;
  revenue_done?: boolean | null;
};

export type KanbanInquiry = {
  status: string;
  kanban_substage_override?: string | null;
};

/** Per-product lifecycle bucket — most-advanced signal wins. */
export function productSubstage(p: KanbanProduct): KanbanColumn {
  if (p.sample_stage) return 'Sampling';
  if (p.quote_stage === 'quoted') return 'Quoted';
  const costingStarted = !!(p.cbm_done || p.cogs_done || p.overhead_done || p.shipping_done || p.revenue_done);
  if (costingStarted || p.design_stage === 'designed' || p.quote_stage === 'quoting' || p.quote_stage === 'ready_for_quote') {
    return 'Costing';
  }
  return 'Idea';
}

/**
 * For 'active' inquiries with no override: the LEAST advanced product's substage
 * (the bottleneck). For non-active statuses: the status's own column. If an
 * override is set on an active inquiry, it short-circuits and wins.
 */
export function inquiryKanbanColumn(inq: KanbanInquiry, prods: KanbanProduct[] | undefined): KanbanColumn {
  if (inq.status !== 'active') {
    return KANBAN_COL_TO_STATUS_INV[inq.status] ?? 'Idea';
  }
  if (inq.kanban_substage_override && KANBAN_SUBSTAGE_LABEL[inq.kanban_substage_override]) {
    return KANBAN_SUBSTAGE_LABEL[inq.kanban_substage_override];
  }
  if (!prods || prods.length === 0) return 'Idea';
  const substages = prods.map(productSubstage);
  const minOrder = Math.min(...substages.map(s => SUBSTAGE_ORDER[s]));
  return ACTIVE_SUBSTAGES[minOrder];
}

const KANBAN_COL_TO_STATUS_INV: Record<string, KanbanColumn> = {
  paused: 'Paused', projected_po: 'Projected PO', po: 'PO', complete: 'Complete', cancelled: 'Cancelled',
};

export type StatusFilter = 'all' | 'active' | 'paused' | 'projected_po' | 'po' | 'cancelled' | 'complete' | 'open';

export function visibleKanbanColumns(statusFilter: StatusFilter): KanbanColumn[] {
  if (!['open', 'all', 'active'].includes(statusFilter)) {
    const map: Record<string, KanbanColumn> = {
      paused: 'Paused', projected_po: 'Projected PO', po: 'PO', complete: 'Complete', cancelled: 'Cancelled',
    };
    return [map[statusFilter]].filter(Boolean) as KanbanColumn[];
  }
  const cols: KanbanColumn[] = [...ACTIVE_SUBSTAGES];
  if (statusFilter !== 'active') {
    cols.push('Paused', 'Projected PO', 'PO');
    if (statusFilter === 'all') cols.push('Complete', 'Cancelled');
  }
  return cols;
}
