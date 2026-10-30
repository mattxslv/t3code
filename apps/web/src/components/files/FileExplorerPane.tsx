import { type CSSProperties, type ReactNode, useState } from "react";

import { RightPanelResizeHandle } from "~/components/preview/RightPanelResizeHandle";
import { RESIZABLE_WIDTH_PROPERTY, useResizableWidth } from "~/hooks/useResizableWidth";
import { observeResize } from "~/lib/observeResize";
import { cn } from "~/lib/utils";
import { useClientSettings } from "~/hooks/useSettings";

const MIN_WIDTH = 160;
const MAX_WIDTH = 560;
const FILE_CONTENT_MIN_WIDTH = 256;

export function FileExplorerPane({
  resizable,
  children,
}: {
  resizable: boolean;
  children: ReactNode;
}) {
  const [maxWidth, setMaxWidth] = useState(MAX_WIDTH);
  const dividerColor = useClientSettings((settings) => settings.editorDividerColor);
  const customDivider = useClientSettings(
    (settings) => settings.customizationsEnabled && settings.editorDividerCustomColorEnabled,
  );
  const explorerLeft = useClientSettings(
    (settings) => settings.customizationsEnabled && settings.explorerOnLeft,
  );
  const { width, setWidth, handlers } = useResizableWidth({
    storageKey: "t3code.fileExplorerWidth",
    defaultWidth: 256,
    minWidth: MIN_WIDTH,
    maxWidth,
    edge: explorerLeft ? "right" : "left",
  });

  return (
    <aside
      ref={(host) => {
        const row = host?.parentElement;
        if (!row || !resizable) return;
        const measure = () =>
          setMaxWidth(
            Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, row.clientWidth - FILE_CONTENT_MIN_WIDTH)),
          );
        measure();
        return observeResize(row, measure);
      }}
      aria-label="File explorer"
      className={cn(
        "relative flex min-h-0 min-w-0 shrink-0 bg-background",
        explorerLeft && "order-first",
        resizable
          ? cn(
              explorerLeft ? "border-r" : "border-l",
              customDivider ? "border-(--resize-handle-idle)" : "border-border/60",
            )
          : "flex-1",
      )}
      style={
        resizable
          ? ({
              [RESIZABLE_WIDTH_PROPERTY]: `${width}px`,
              "--resize-handle-idle": dividerColor,
              "--resize-handle-hover": `color-mix(in srgb, ${dividerColor} 80%, var(--foreground))`,
              "--resize-handle-active": `color-mix(in srgb, ${dividerColor} 60%, var(--foreground))`,
              width: `var(${RESIZABLE_WIDTH_PROPERTY})`,
            } as CSSProperties)
          : undefined
      }
    >
      {resizable ? (
        <RightPanelResizeHandle
          customAppearance={customDivider}
          edge={explorerLeft ? "right" : "left"}
          handlers={handlers}
          label="Resize file explorer"
          tabIndex={0}
          aria-valuenow={width}
          aria-valuemin={MIN_WIDTH}
          aria-valuemax={maxWidth}
          onKeyDown={(event) => {
            if (event.altKey || event.ctrlKey || event.metaKey) return;
            let nextWidth: number;
            switch (event.key) {
              case "ArrowLeft":
                nextWidth = width + (explorerLeft ? -16 : 16);
                break;
              case "ArrowRight":
                nextWidth = width + (explorerLeft ? 16 : -16);
                break;
              case "Home":
                nextWidth = MIN_WIDTH;
                break;
              case "End":
                nextWidth = maxWidth;
                break;
              default:
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            setWidth(nextWidth);
          }}
        />
      ) : null}
      {children}
    </aside>
  );
}
