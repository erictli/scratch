import TaskItem from "@tiptap/extension-task-item";
import { TextSelection } from "@tiptap/pm/state";

/**
 * Custom TaskItem extension that preserves the `checked` state of an existing
 * task when pressing Enter at the very start of it to insert a new task above.
 *
 * TipTap's default `splitListItem` keeps `checked: true` on the newly created
 * empty item above and resets the pushed-down existing item to `checked: false`
 * because `checked` has `keepOnSplit: false`.
 */
export const ScratchTaskItem = TaskItem.extend({
  addKeyboardShortcuts() {
    const parentShortcuts = this.parent?.() ?? {};
    return {
      ...parentShortcuts,
      Enter: () => {
        const { state } = this.editor;
        const { selection } = state;
        const { $from, empty } = selection;

        if (
          empty &&
          $from.depth >= 2 &&
          $from.parentOffset === 0 &&
          $from.index(-1) === 0 &&
          $from.parent.content.size > 0
        ) {
          const taskItemNode = $from.node(-1);
          if (
            taskItemNode.type.name === this.name &&
            taskItemNode.attrs.checked
          ) {
            const taskItemPos = $from.before(-1);
            const paragraphType = state.schema.nodes.paragraph;
            const emptyTaskItem = taskItemNode.type.create(
              { ...taskItemNode.attrs, checked: false },
              paragraphType ? paragraphType.create() : undefined,
            );

            return this.editor.commands.command(({ tr, dispatch }) => {
              if (dispatch) {
                tr.insert(taskItemPos, emptyTaskItem);
                const pushedDownStart =
                  taskItemPos + emptyTaskItem.nodeSize + 2;
                tr.setSelection(
                  TextSelection.near(tr.doc.resolve(pushedDownStart)),
                );
                tr.scrollIntoView();
              }
              return true;
            });
          }
        }

        return this.editor.commands.splitListItem(this.name);
      },
    };
  },
});
