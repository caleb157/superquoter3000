/** Display helpers: company is the primary identity, contact name is secondary. */
export type CustomerLike = { name?: string | null; company?: string | null } | null | undefined;

/** Primary label for a customer — company first, falling back to contact name. */
export function customerPrimary(c: CustomerLike, fallback = ''): string {
  if (!c) return fallback;
  return (c.company?.trim() || c.name?.trim() || fallback);
}

/** Secondary label (contact name) — null when it adds nothing. */
export function customerSecondary(c: CustomerLike): string | null {
  if (!c) return null;
  const company = c.company?.trim();
  const name = c.name?.trim();
  if (!company || !name || name === company) return null;
  return name;
}

/** "Company · Contact" one-liner. */
export function customerFullLabel(c: CustomerLike, fallback = ''): string {
  const primary = customerPrimary(c, fallback);
  const secondary = customerSecondary(c);
  return secondary ? `${primary} · ${secondary}` : primary;
}
