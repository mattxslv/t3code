import { page, userEvent } from "vite-plus/test/browser";
import { describe, expect, it, vi } from "vite-plus/test";

import { render } from "../../../test/render";
import { Sidebar, SidebarProvider, SidebarRail, SidebarTrigger, useSidebar } from "./sidebar";

function CollapseFromInside() {
  const { setOpen } = useSidebar();
  return (
    <button type="button" onClick={() => setOpen(false)}>
      Collapse
    </button>
  );
}

function Harness(props: {
  readonly onResize?: (width: number) => void;
  readonly side?: "left" | "right";
}) {
  return (
    <SidebarProvider defaultOpen>
      <Sidebar
        side={props.side ?? "left"}
        style={{ width: 256 }}
        collapsible="offcanvas"
        resizable={{
          minWidth: 200,
          maxWidth: 600,
          ...(props.onResize ? { onResize: props.onResize } : {}),
        }}
      >
        <CollapseFromInside />
        <SidebarRail />
      </Sidebar>
      <SidebarTrigger />
    </SidebarProvider>
  );
}

describe("Sidebar", () => {
  it("hands focus to the outside trigger when it collapses around the focused control", async () => {
    await page.viewport(1280, 800);
    await using screen = await render(<Harness />, { router: false /* no routes involved */ });

    await userEvent.click(screen.getByRole("button", { name: "Collapse" }));

    const sidebar = screen.container.querySelector<HTMLElement>('[data-slot="sidebar"]')!;
    await vi.waitFor(() => expect(sidebar.inert).toBe(true));
    const trigger = screen.container.querySelector('[data-slot="sidebar-trigger"]');
    await vi.waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it.each(["left", "right"] as const)(
    "resizes the %s sidebar and abandons a drag when it collapses",
    async (side) => {
      await page.viewport(1280, 800);
      const onResize = vi.fn();
      await using screen = await render(<Harness side={side} onResize={onResize} />, {
        router: false /* no routes involved */,
      });
      const rail = screen.container.querySelector<HTMLElement>('[data-sidebar="rail"]')!;
      const { left, top } = rail.getBoundingClientRect();
      const pointer = {
        bubbles: true,
        cancelable: true,
        pointerId: 1,
        button: 0,
        clientY: top + 10,
      };
      const dragTo = (clientX: number) => {
        rail.dispatchEvent(new PointerEvent("pointerdown", { ...pointer, clientX: left }));
        rail.dispatchEvent(new PointerEvent("pointermove", { ...pointer, clientX }));
      };
      // A completed drag commits, so the abandoned one below is a real drag too.
      const direction = side === "left" ? 1 : -1;
      const initialWidth = screen.container
        .querySelector<HTMLElement>('[data-slot="sidebar-container"]')!
        .getBoundingClientRect().width;
      dragTo(left + direction * 40);
      rail.dispatchEvent(
        new PointerEvent("pointerup", { ...pointer, clientX: left + direction * 40 }),
      );
      expect(onResize).toHaveBeenCalledTimes(1);
      expect(onResize).toHaveBeenLastCalledWith(initialWidth + 40);

      dragTo(left + direction * 80);
      await userEvent.click(
        screen.container.querySelector<HTMLElement>('[data-slot="sidebar-trigger"]')!,
      );
      rail.dispatchEvent(
        new PointerEvent("pointerup", { ...pointer, clientX: left + direction * 80 }),
      );

      expect(onResize).toHaveBeenCalledTimes(1);
    },
  );
});
