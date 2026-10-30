const ABSOLUTE_LOCAL_PATH = /^(?:[a-z]:[\\/]|\\\\[^\\]+\\[^\\]+|\/)/i;

export function parseTransferredFilePaths(text: string): string[] {
  const paths: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    let path = raw.trim();
    if (!path || path.startsWith("#") || path === "copy" || path === "cut") continue;
    if (path.startsWith('"') && path.endsWith('"')) path = path.slice(1, -1);
    const fileUri = /^file:/i.test(path);
    if (fileUri) {
      try {
        const url = new URL(path);
        path = decodeURIComponent(url.pathname);
        if (url.hostname && url.hostname !== "localhost")
          path = `\\\\${url.hostname}${path.replaceAll("/", "\\")}`;
        else if (/^\/[a-z]:\//i.test(path)) path = path.slice(1).replaceAll("/", "\\");
      } catch {
        return [];
      }
    }
    if (path.includes("\0") || !ABSOLUTE_LOCAL_PATH.test(path)) return [];
    if (!fileUri && /^\/[^/.]+$/.test(path)) return [];
    paths.push(path);
  }
  return [...new Set(paths)];
}

export function resolveTransferredFilePaths(
  files: readonly File[],
  getPathForFile?: (file: File) => string,
) {
  const paths: string[] = [];
  for (const file of files) {
    let path: string | undefined;
    try {
      path = getPathForFile?.(file);
    } catch {
      return null;
    }
    if (!path || path.includes("\0") || !ABSOLUTE_LOCAL_PATH.test(path)) return null;
    paths.push(path);
  }
  return [...new Set(paths)];
}

// Clipboard screenshots and browser images have no file on disk, so a path reference is impossible.
export function shouldUploadUnresolvedFiles(files: readonly File[]) {
  return files.length > 0 && files.every((file) => file.type.startsWith("image/"));
}
