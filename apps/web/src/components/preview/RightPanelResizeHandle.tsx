import type { ComponentProps } from "react";
import type { ResizableWidthHandlers } from "~/hooks/useResizableWidth";
import { cn } from "~/lib/utils";

interface Props extends Pick<
  ComponentProps<"div">,
  "tabIndex" | "onKeyDown" | "aria-valuenow" | "aria-valuemin" | "aria-valuemax"
> {
  handlers: ResizableWidthHandlers;
  className?: string;
  label?: string;
  edge?: "left" | "right";
  customAppearance?: boolean;
}

export function RightPanelResizeHandle({
  handlers,
  className,
  label,
  edge = "left",
  customAppearance = false,
  ...separatorProps
}: Props) {
  return (
    <div
      role="separator"
      aria-label={label}
      aria-orientation="vertical"
      {...separatorProps}
      className={cn(
        "group absolute inset-y-0 z-20 w-2 cursor-col-resize select-none",
        edge === "left" ? "-left-1" : "-right-1",
        className,
      )}
      {...handlers}
    >
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 transition-colors duration-150 motion-reduce:transition-none",
          customAppearance
            ? "bg-(--resize-handle-idle) group-hover:w-0.5 group-hover:bg-(--resize-handle-hover) group-focus-visible:w-0.5 group-focus-visible:bg-(--resize-handle-active) group-focus-visible:outline-2 group-focus-visible:-outline-offset-2 group-focus-visible:outline-ring group-data-[resizing=true]:w-0.5 group-data-[resizing=true]:bg-(--resize-handle-active)"
            : "bg-transparent group-hover:bg-border group-focus-visible:bg-primary/60 group-active:bg-primary/60",
        )}
      />
    </div>
  );
}
