import { type LucideIcon } from 'lucide-react';
import { TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

export type ResponsiveTabOption = {
  value: string;
  label: string;
  icon?: LucideIcon;
};

type ResponsiveTabsProps = {
  value: string;
  onValueChange: (v: string) => void;
  options: ResponsiveTabOption[];
  /** Optional class for the desktop TabsList */
  listClassName?: string;
  /** Optional class for each TabsTrigger */
  triggerClassName?: string;
};

/**
 * Renders a horizontal `TabsList` on `md+` and a `Select` dropdown on mobile.
 * Must be rendered inside a `<Tabs value={...} onValueChange={...}>` parent so
 * Radix can sync state with the matching `<TabsContent>` blocks.
 */
export function ResponsiveTabs({
  value, onValueChange, options, listClassName, triggerClassName,
}: ResponsiveTabsProps) {
  const current = options.find(o => o.value === value) ?? options[0];

  return (
    <>
      {/* Mobile: Select dropdown */}
      <div className="md:hidden">
        <Select value={value} onValueChange={onValueChange}>
          <SelectTrigger className="h-10 w-full">
            <SelectValue>
              <span className="flex items-center gap-2">
                {current?.icon && <current.icon className="h-4 w-4" />}
                {current?.label}
              </span>
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {options.map(opt => (
              <SelectItem key={opt.value} value={opt.value}>
                <span className="flex items-center gap-2">
                  {opt.icon && <opt.icon className="h-4 w-4" />}
                  {opt.label}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Desktop: traditional TabsList */}
      <div className="hidden md:block">
        <TabsList className={cn('inline-flex w-max', listClassName)}>
          {options.map(opt => (
            <TabsTrigger
              key={opt.value}
              value={opt.value}
              className={cn('text-xs gap-1.5', triggerClassName)}
            >
              {opt.icon && <opt.icon className="h-3.5 w-3.5" />}
              {opt.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
    </>
  );
}
