import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";

import { cn } from "@/lib/utils";

// Hover tooltips are off app-wide, except on icons (Caleb, 2026-11-16).
// - TooltipContent renders nothing, so text, headers, totals and labelled buttons
//   never open a hover box.
// - IconTooltipContent is the real tooltip. Use it ONLY when the trigger is an icon
//   with no visible text (icon-only buttons, status / warning icons).
// Icon-only buttons still need their own aria-label. Click popovers, dialogs and
// chart tooltips (recharts) are separate and unaffected.

const TooltipProvider = TooltipPrimitive.Provider;

const Tooltip = TooltipPrimitive.Root;

const TooltipTrigger = TooltipPrimitive.Trigger;

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>((_props, _ref) => null);
TooltipContent.displayName = TooltipPrimitive.Content.displayName;

const IconTooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
  // Portaled to <body> so scroll containers and sticky headers can't clip or cover it.
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        "z-50 overflow-hidden rounded-md border bg-popover px-3 py-1.5 text-sm text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
        className,
      )}
      {...props}
    />
  </TooltipPrimitive.Portal>
));
IconTooltipContent.displayName = "IconTooltipContent";

export { Tooltip, TooltipTrigger, TooltipContent, IconTooltipContent, TooltipProvider };
