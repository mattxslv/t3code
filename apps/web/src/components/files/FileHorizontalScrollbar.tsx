import { useLayoutEffect, useState } from "react";
import { observeResize } from "~/lib/observeResize";
import { useClientSettings } from "~/hooks/useSettings";

export function FileHorizontalScrollbar({ enabled }: { enabled: boolean }) {
  const featureEnabled = useClientSettings(
    (settings) => settings.customizationsEnabled && settings.fileHorizontalScrollbarEnabled,
  );
  const [bar, setBar] = useState<HTMLDivElement | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- synchronizes the viewport scrollbar with Pierre's shadow-root code scroller
  useLayoutEffect(() => {
    const root = bar?.parentElement;
    const spacer = bar?.firstElementChild;
    if (!enabled || !featureEnabled || !bar || !root || !(spacer instanceof HTMLElement)) return;
    let code: HTMLElement | null = null;
    let shadow: ShadowRoot | null = null;
    let stopObserving = () => {};
    const measure = () => {
      const overflow = code ? Math.max(0, code.scrollWidth - code.clientWidth) : 0;
      bar.hidden = overflow <= 1;
      spacer.style.width = `${overflow + (bar.clientWidth || root.clientWidth)}px`;
      if (code) bar.scrollLeft = code.scrollLeft;
    };
    const fromCode = () => {
      if (code) bar.scrollLeft = code.scrollLeft;
    };
    const fromBar = () => {
      if (code && code.scrollLeft !== bar.scrollLeft) code.scrollLeft = bar.scrollLeft;
    };
    const shadowMutations = new MutationObserver(() => connect());
    const connect = () => {
      const nextShadow = root.querySelector("diffs-container")?.shadowRoot ?? null;
      if (nextShadow !== shadow) {
        shadowMutations.disconnect();
        shadow = nextShadow;
        if (shadow)
          shadowMutations.observe(shadow, { childList: true, subtree: true, characterData: true });
      }
      const next = shadow?.querySelector<HTMLElement>("[data-code]") ?? null;
      if (next === code) {
        measure();
        return;
      }
      code?.removeEventListener("scroll", fromCode);
      stopObserving();
      code = next;
      if (code) {
        code.addEventListener("scroll", fromCode, { passive: true });
      }
      stopObserving = observeResize(
        code ? [bar, root, code, ...code.children] : [bar, root],
        measure,
      );
      measure();
    };
    const mutations = new MutationObserver(connect);
    mutations.observe(root, { childList: true, subtree: true });
    bar.addEventListener("scroll", fromBar, { passive: true });
    connect();
    return () => {
      mutations.disconnect();
      shadowMutations.disconnect();
      stopObserving();
      code?.removeEventListener("scroll", fromCode);
      bar.removeEventListener("scroll", fromBar);
    };
  }, [bar, enabled, featureEnabled]);
  if (!enabled || !featureEnabled) return null;
  return (
    <div
      ref={setBar}
      role="region"
      aria-label="Scroll file horizontally"
      tabIndex={0}
      className="file-horizontal-scrollbar h-4.5 shrink-0 overflow-x-scroll overflow-y-hidden bg-code outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
    >
      <div className="h-px" />
    </div>
  );
}
