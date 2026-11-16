import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";

// Hover tooltips are switched off app-wide (Caleb, 2026-11-16: the hover boxes got in the way).
// Tooltip / TooltipTrigger stay as pass-throughs so existing markup keeps working, but
// TooltipContent renders nothing, so hovering never opens a box. Icon-only buttons must
// carry their own aria-label; don't rely on a tooltip for the name. Click popovers,
// dialogs and chart tooltips (recharts) are separate and unaffected.

const TooltipProvider = TooltipPrimitive.Provider;

const Tooltip = TooltipPrimitive.Root;

const TooltipTrigger = TooltipPrimitive.Trigger;

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>((_props, _ref) => null);
TooltipContent.displayName = TooltipPrimitive.Content.displayName;

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
