import { expect, it, vi } from "vite-plus/test";
import { render } from "../../../test/render";
import { FileHorizontalScrollbar } from "./FileHorizontalScrollbar";
import "../../index.css";

function sourceHost(node: HTMLDivElement | null) {
  if (!node || node.firstChild) return;
  const host = document.createElement("diffs-container");
  host.attachShadow({ mode: "open" });
  node.append(host);
}

function Fixture({ wrap = false }: { wrap?: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", width: 240, height: 100 }}>
      <div ref={sourceHost} />
      <FileHorizontalScrollbar enabled={!wrap} />
    </div>
  );
}

it("connects after code renders, synchronizes both directions, and hides when wrapping or overflow disappears", async () => {
  await using screen = await render(<Fixture />, {
    router: false /* scrollbar has no navigation */,
  });
  const bar = screen.container.querySelector<HTMLElement>(".file-horizontal-scrollbar")!;
  const shadow = screen.container.querySelector("diffs-container")!.shadowRoot!;
  const code = document.createElement("div");
  code.dataset.code = "";
  code.style.cssText = "width:240px;overflow-x:auto";
  const content = document.createElement("div");
  content.style.cssText = "width:1200px;height:1px";
  code.append(content);
  shadow.append(code);
  await vi.waitFor(() => {
    expect(bar.hidden).toBe(false);
    expect(bar.scrollWidth - bar.clientWidth).toBe(code.scrollWidth - code.clientWidth);
  });
  bar.scrollLeft = 100;
  bar.dispatchEvent(new Event("scroll"));
  expect(code.scrollLeft).toBe(100);
  code.scrollLeft = 240;
  code.dispatchEvent(new Event("scroll"));
  expect(bar.scrollLeft).toBe(240);
  content.style.width = "100px";
  await vi.waitFor(() => expect(bar.hidden).toBe(true));
  await screen.rerender(<Fixture wrap />);
  expect(screen.container.querySelector(".file-horizontal-scrollbar")).toBeNull();
});
