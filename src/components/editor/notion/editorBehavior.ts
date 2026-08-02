/**
 * Lists already provide their own continuation/exit behavior. Appending a
 * paragraph after every list edit creates a second empty line when the block
 * handle adds a new item at the end of a note.
 */
export const SCRATCH_TRAILING_NODE_OPTIONS = {
  notAfter: ["bulletList", "orderedList", "taskList"],
};
