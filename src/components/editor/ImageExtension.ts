import { Extension, type JSONContent, type MarkdownToken } from "@tiptap/core";
import Image from "@tiptap/extension-image";
import { convertFileSrc } from "@tauri-apps/api/core";

export interface ScratchImageStorage {
  notesFolder: string | null;
  noteDir: string | null;
}

const IMAGE_EXT_RE = /\.(?:png|jpe?g|gif|webp|svg|bmp|tiff?|ico|avif)$/i;
const REMOTE_OR_RESOLVED_RE = /^(?:https?:|asset:|data:|blob:|tauri:)/i;
const WINDOWS_ABS_RE = /^[a-zA-Z]:[\\/]/;

function safeDecodeUri(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

/** Extract the parent directory of an absolute file path (POSIX or Windows). */
export function getParentDir(filePath: string | null | undefined): string | null {
  if (!filePath) return null;
  const normalized = filePath.replace(/\\/g, "/");
  const lastSlash = normalized.lastIndexOf("/");
  if (lastSlash <= 0) return null;
  return filePath.slice(0, lastSlash);
}

/** Resolve a relative path against a base directory, normalizing `.` and `..` segments. */
export function resolveRelativeFsPath(baseDir: string, relPath: string): string {
  const isWindowsPath = WINDOWS_ABS_RE.test(baseDir) || baseDir.includes("\\");
  const normBase = baseDir.replace(/\\/g, "/").replace(/\/+$/, "");
  const normRel = relPath.replace(/\\/g, "/");

  let prefix = "";
  let baseRest = normBase;
  if (WINDOWS_ABS_RE.test(normBase)) {
    prefix = normBase.slice(0, 2);
    baseRest = normBase.slice(2);
  } else if (normBase.startsWith("/")) {
    prefix = "/";
    baseRest = normBase.slice(1);
  }

  const stack = baseRest.split("/").filter(Boolean);
  for (const part of normRel.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (stack.length > 0) stack.pop();
    } else {
      stack.push(part);
    }
  }

  const joined =
    prefix === "/"
      ? `/${stack.join("/")}`
      : prefix
        ? `${prefix}/${stack.join("/")}`
        : stack.join("/");

  return isWindowsPath ? joined.replace(/\//g, "\\") : joined;
}

/**
 * Compute ordered local filesystem candidate paths for a Markdown image `src`.
 * Returns `null` when `src` is already a remote/asset/data URL.
 */
export function buildImageCandidatePaths(
  rawSrc: string,
  notesFolder: string | null,
  noteDir: string | null,
): string[] | null {
  const trimmed = rawSrc.trim();
  if (!trimmed || REMOTE_OR_RESOLVED_RE.test(trimmed)) {
    return null;
  }

  const decoded = safeDecodeUri(trimmed);
  if (decoded.startsWith("/") || WINDOWS_ABS_RE.test(decoded)) {
    return [decoded];
  }

  const candidates: string[] = [];
  const pushUnique = (p: string) => {
    if (!candidates.includes(p)) candidates.push(p);
  };

  if (noteDir) {
    pushUnique(resolveRelativeFsPath(noteDir, decoded));
  }
  if (notesFolder) {
    pushUnique(resolveRelativeFsPath(notesFolder, decoded));
    // Support Obsidian bare filename embeds (e.g. ![[photo.png]] or ![](photo.png))
    // stored inside the vault's assets/ folder.
    const cleanRel = decoded.replace(/^\.\//, "");
    if (!cleanRel.includes("/")) {
      pushUnique(resolveRelativeFsPath(notesFolder, `assets/${cleanRel}`));
    }
  }

  return candidates;
}

/**
 * Compute a portable Markdown relative path from the current note to a vault-root
 * asset path (e.g., `assets/photo.png` or `../assets/photo.png` for nested notes).
 */
export function computePortableImagePath(
  vaultRelativePath: string,
  noteId: string | null,
): string {
  const cleanAsset = vaultRelativePath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!noteId || !noteId.includes("/")) {
    return cleanAsset;
  }
  const depth = noteId.split("/").length - 1;
  return `${"../".repeat(depth)}${cleanAsset}`;
}

function resolveDisplayCandidates(
  rawSrc: string,
  storage: ScratchImageStorage | undefined,
): string[] {
  const fsCandidates = buildImageCandidatePaths(
    rawSrc,
    storage?.notesFolder ?? null,
    storage?.noteDir ?? null,
  );
  if (fsCandidates === null) {
    return [rawSrc];
  }
  return fsCandidates.map((fsPath) => convertFileSrc(fsPath));
}

export const ScratchImage = Image.extend<
  Record<string, unknown>,
  ScratchImageStorage
>({
  addStorage() {
    return {
      notesFolder: null,
      noteDir: null,
    };
  },

  addNodeView() {
    return ({ node, editor }) => {
      const img = document.createElement("img");

      const applyNode = (currentNode: typeof node) => {
        const rawSrc = String(currentNode.attrs.src ?? "");
        const alt = currentNode.attrs.alt;
        const title = currentNode.attrs.title;
        const width = currentNode.attrs.width;
        const height = currentNode.attrs.height;

        if (alt != null) img.alt = String(alt);
        else img.removeAttribute("alt");
        if (title != null) img.title = String(title);
        else img.removeAttribute("title");
        if (width != null) img.setAttribute("width", String(width));
        else img.removeAttribute("width");
        if (height != null) img.setAttribute("height", String(height));
        else img.removeAttribute("height");

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const storage = (editor.storage as any).image as
          | ScratchImageStorage
          | undefined;
        const candidates = resolveDisplayCandidates(rawSrc, storage);
        let idx = 0;

        img.onerror = () => {
          idx += 1;
          if (idx < candidates.length) {
            img.src = candidates[idx];
          }
        };

        img.src = candidates[0] ?? rawSrc;
      };

      applyNode(node);

      return {
        dom: img,
        update(updatedNode) {
          if (updatedNode.type.name !== node.type.name) return false;
          applyNode(updatedNode);
          return true;
        },
      };
    };
  },
});

/**
 * Parse Obsidian-style image embeds `![[filename.png]]` or `![[filename.png|alt]]`
 * into standard TipTap `image` nodes so Obsidian vaults render seamlessly in Scratch.
 */
export const ObsidianImageEmbed = Extension.create({
  name: "obsidianImageEmbed",

  markdownTokenName: "obsidianImageEmbed",

  markdownTokenizer: {
    name: "obsidianImageEmbed",
    level: "inline" as const,
    start: "![[",
    tokenize(src: string, _tokens: MarkdownToken[]) {
      const match = src.match(/^!\[\[([^\]|]+?)(?:\|([^\]]*))?\]\]/);
      if (!match) return undefined;
      const target = match[1].trim();
      if (!IMAGE_EXT_RE.test(target)) return undefined;
      return {
        type: "obsidianImageEmbed",
        raw: match[0],
        href: target,
        text: (match[2] ?? "").trim(),
      };
    },
  },

  parseMarkdown(token: MarkdownToken, helpers) {
    return helpers.createNode("image", {
      src: token.href ?? "",
      alt: token.text ?? "",
    }) as JSONContent;
  },
});
