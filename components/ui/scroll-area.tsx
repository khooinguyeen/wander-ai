"use client";

import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area";
import { forwardRef } from "react";
import type { ComponentPropsWithoutRef, ElementRef } from "react";

import { cn } from "@/lib/utils";

const ScrollArea = forwardRef<
  ElementRef<typeof ScrollAreaPrimitive.Root>,
  ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.Root>
>(({ className, children, ...props }, ref) => (
  <ScrollAreaPrimitive.Root ref={ref} className={cn("ui-scroll-area", className)} {...props}>
    <ScrollAreaPrimitive.Viewport className="ui-scroll-area__viewport">{children}</ScrollAreaPrimitive.Viewport>
    <ScrollBar />
    <ScrollAreaPrimitive.Corner className="ui-scroll-area__corner" />
  </ScrollAreaPrimitive.Root>
));

ScrollArea.displayName = ScrollAreaPrimitive.Root.displayName;

const ScrollBar = forwardRef<
  ElementRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>,
  ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>
>(({ className, orientation = "vertical", ...props }, ref) => (
  <ScrollAreaPrimitive.ScrollAreaScrollbar
    ref={ref}
    orientation={orientation}
    className={cn("ui-scroll-area__scrollbar", `ui-scroll-area__scrollbar--${orientation}`, className)}
    {...props}
  >
    <ScrollAreaPrimitive.ScrollAreaThumb className="ui-scroll-area__thumb" />
  </ScrollAreaPrimitive.ScrollAreaScrollbar>
));

ScrollBar.displayName = ScrollAreaPrimitive.ScrollAreaScrollbar.displayName;

export { ScrollArea };
