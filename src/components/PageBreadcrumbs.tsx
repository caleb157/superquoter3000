import { Link, useLocation } from 'react-router-dom';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import type { BreadcrumbOrigin, RowNavState } from '@/lib/row-nav';

export type Crumb = { label: string; to?: string };

/**
 * Renders breadcrumb trail for detail pages.
 *
 * `canonical` is the natural hierarchy (e.g. Inquiries / DKT-0042 / Product).
 * If the user arrived from a different list (location.state.from), that origin
 * is prepended as the first crumb so they can jump back in one click.
 */
export function PageBreadcrumbs({
  canonical,
  current,
}: {
  canonical: Crumb[];
  current: string;
}) {
  const location = useLocation();
  const fromState = (location.state as RowNavState | null)?.from;

  // Avoid double-listing the origin if it already matches the first canonical crumb.
  const origin: BreadcrumbOrigin | null =
    fromState && fromState.path !== canonical[0]?.to ? fromState : null;

  const crumbs: Crumb[] = origin
    ? [{ label: origin.label, to: origin.path }, ...canonical]
    : canonical;

  return (
    <Breadcrumb className="mb-1">
      <BreadcrumbList className="text-xs sm:text-xs gap-1 sm:gap-1.5">
        {crumbs.map((c, i) => (
          <BreadcrumbItem key={`${c.label}-${i}`}>
            {c.to ? (
              <BreadcrumbLink asChild>
                <Link to={c.to} className="hover:text-foreground transition-colors">
                  {c.label}
                </Link>
              </BreadcrumbLink>
            ) : (
              <span>{c.label}</span>
            )}
            <BreadcrumbSeparator className="ml-1" />
          </BreadcrumbItem>
        ))}
        <BreadcrumbItem>
          <BreadcrumbPage className="truncate max-w-[260px] sm:max-w-[420px]">{current}</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  );
}
