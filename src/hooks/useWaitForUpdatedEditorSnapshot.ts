import { useCallback, type RefObject } from "react";
import type { Editor as TiptapEditor } from "@tiptap/react";

export function useWaitForUpdatedEditorSnapshot(
  editorRef: RefObject<TiptapEditor | null>,
) {
  return useCallback(
    async (beforeSerialized: string) => {
      // Let React commit currentNote updates and Editor's setContent run.
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve());
      });

      if (!editorRef.current) {
        throw new Error("Editor not ready");
      }

      let afterJson = editorRef.current.getJSON();
      let afterSerialized = JSON.stringify(afterJson);

      // If content hasn't changed yet, poll briefly for async editor updates.
      if (afterSerialized === beforeSerialized) {
        const deadline = performance.now() + 500;
        while (performance.now() < deadline) {
          await new Promise<void>((resolve) => {
            setTimeout(resolve, 16);
          });
          if (!editorRef.current) break;
          afterJson = editorRef.current.getJSON();
          afterSerialized = JSON.stringify(afterJson);
          if (afterSerialized !== beforeSerialized) break;
        }
      }

      return afterJson;
    },
    [editorRef],
  );
}
