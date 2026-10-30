import { describe, expect, it } from "vite-plus/test";
import { parseTransferredFilePaths, resolveTransferredFilePaths } from "./composerFilePaths";

describe("composer file paths", () => {
  it("recognizes Windows Copy as path, UNC shares, and Linux URI lists without reading file bytes", () => {
    expect(
      parseTransferredFilePaths('"C:\\Videos\\large movie.mp4"\r\n"D:\\Work\\notes.txt"'),
    ).toEqual(["C:\\Videos\\large movie.mp4", "D:\\Work\\notes.txt"]);
    expect(parseTransferredFilePaths("\\\\server\\share\\video.mp4")).toEqual([
      "\\\\server\\share\\video.mp4",
    ]);
    expect(
      parseTransferredFilePaths(
        "copy\nfile:///home/user/My%20Video.mp4\nfile:///home/user/My%20Video.mp4",
      ),
    ).toEqual(["/home/user/My Video.mp4"]);
    expect(parseTransferredFilePaths("# local file\nfile:///C:/Videos/My%20Video.mp4")).toEqual([
      "C:\\Videos\\My Video.mp4",
    ]);
    expect(parseTransferredFilePaths("file://server/share/a.txt")).toEqual([
      "\\\\server\\share\\a.txt",
    ]);
  });

  it("leaves normal text, slash commands, web URLs, and malformed paths to ordinary paste", () => {
    for (const text of [
      "hello",
      "/usage-limits",
      "https://example.com/file.mp4",
      "file:///%ZZ",
      "relative/video.mp4",
      "See this file:\nC:\\video.mp4",
      "C:\\bad\0name",
    ]) {
      expect(parseTransferredFilePaths(text)).toEqual([]);
    }
  });

  it("requires a real absolute path for every native file and never fabricates one from a filename", () => {
    const first = new File([], "video.mp4");
    const second = new File([], "notes.txt");
    expect(resolveTransferredFilePaths([first])).toBeNull();
    expect(resolveTransferredFilePaths([first], () => "video.mp4")).toBeNull();
    expect(
      resolveTransferredFilePaths([first, second], (file) =>
        file === first ? "C:\\Videos\\video.mp4" : "",
      ),
    ).toBeNull();
    expect(
      resolveTransferredFilePaths([first], () => {
        throw new Error("No native file");
      }),
    ).toBeNull();
    expect(
      resolveTransferredFilePaths([first, second], (file) => `/home/user/${file.name}`),
    ).toEqual(["/home/user/video.mp4", "/home/user/notes.txt"]);
  });
});
