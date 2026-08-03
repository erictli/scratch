import { TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

export type ImageOpenTarget =
  | { kind: "path"; value: string }
  | { kind: "url"; value: string };

export function getImageOpenTarget(source: string): ImageOpenTarget | null {
  try {
    const url = new URL(source);
    const isTauriAsset =
      url.protocol === "asset:" || url.hostname === "asset.localhost";

    if (isTauriAsset) {
      const encodedPath = url.pathname.replace(/^\//, "");
      const filePath = decodeURIComponent(encodedPath);
      if (
        filePath.startsWith("/") ||
        /^[a-zA-Z]:[\\/]/.test(filePath)
      ) {
        return { kind: "path", value: filePath };
      }
      return null;
    }

    if (url.protocol === "http:" || url.protocol === "https:") {
      return { kind: "url", value: url.toString() };
    }
  } catch {
    return null;
  }

  return null;
}

export function handleImageDoubleClick(
  view: EditorView,
  event: MouseEvent,
): boolean {
  const eventTarget = event.target;
  if (!(eventTarget instanceof Element)) return false;
  const image = eventTarget.closest("img");
  if (!image || !view.dom.contains(image)) return false;

  event.preventDefault();
  const imagePosition = view.posAtDOM(image, 0);
  const imageNode = view.state.doc.nodeAt(imagePosition);
  if (imageNode?.type.name === "image") {
    const cursorPosition = Math.min(
      imagePosition + imageNode.nodeSize,
      view.state.doc.content.size,
    );
    view.dispatch(
      view.state.tr
        .setSelection(
          TextSelection.near(view.state.doc.resolve(cursorPosition), 1),
        )
        .scrollIntoView(),
    );
  }
  view.focus();
  return true;
}
