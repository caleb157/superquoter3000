// Account pages live at /customers/:id but belong to the Sales CRM. Every link into one from Sales says
// which Sales tab it came from, so Back and the breadcrumb return there and never to the old Customers list.
// No imports: shared by the Sales tabs, the account page and tests.

export const SALES_TAB_LABELS: Record<string, string> = {
  overview: 'Command center',
  needs: 'Needs you',
  pipeline: 'Pipeline',
  accounts: 'Accounts',
  prospects: 'Prospects',
  prospecting: 'Prospecting',
  traction: 'Traction',
  content: 'Content',
  jobs: 'Jobs',
};

/** The account list inside Sales (what the Customers page used to be). */
export const ACCOUNTS_PATH = '/sales?tab=accounts';

export type SalesOrigin = { label: string; path: string };

export function salesTabPath(tab: string): string {
  return tab === 'overview' ? '/sales' : `/sales?tab=${encodeURIComponent(tab)}`;
}

/** Router state for a link from a Sales tab to an account page. */
export function fromSalesTab(tab: string): { from: SalesOrigin } {
  return { from: { label: SALES_TAB_LABELS[tab] ?? 'Sales', path: salesTabPath(tab) } };
}

export function accountPath(id: string): string {
  return `/customers/${id}?tab=sales`;
}

/** Where Back goes from an account page: the page it was opened from, else Sales > Accounts. */
export function accountBackTarget(state: unknown): SalesOrigin {
  const from = (state as { from?: Partial<SalesOrigin> } | null)?.from;
  if (from && typeof from.path === 'string' && from.path.startsWith('/') && !from.path.startsWith('//') && !/^\/customers\/?(\?|$)/.test(from.path)) {
    return { label: typeof from.label === 'string' && from.label ? from.label : 'Back', path: from.path };
  }
  return { label: 'Accounts', path: ACCOUNTS_PATH };
}

/** Old /customers list links (with their ?tab=... group) land on Sales > Accounts with the same group picked. */
export function redirectFromCustomers(search: string): string {
  const p = new URLSearchParams(search);
  const group = p.get('group') ?? p.get('tab');
  return group ? `${ACCOUNTS_PATH}&group=${encodeURIComponent(group)}` : ACCOUNTS_PATH;
}
