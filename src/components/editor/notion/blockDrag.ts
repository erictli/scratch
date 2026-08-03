import type { Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import { TABLE_AXIS_STRUCTURAL_OUTER_PROXIMITY } from "./tableProximity";

export interface BlockDragTarget {
  node: ProseMirrorNode;
  pos: number;
}

export interface BlockDropPoint {
  left: number;
  top: number;
}

export interface BlockDragRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
}

export interface ResolvedBlockDropTarget {
  position: number;
  indicatorTop: number;
  indicatorLeft: number;
  indicatorWidth: number;
}

const BLOCK_POINTER_DRAG_THRESHOLD = 4;
const LIST_ITEM_NODE_TYPES = new Set(["listItem", "taskItem"]);
const LIST_CONTAINER_NODE_TYPES = new Set([
  "bulletList",
  "orderedList",
  "taskList",
]);

export function getTableBlockHandleReferenceRect(
  tableRect: BlockDragRect,
): BlockDragRect {
  const height = Math.min(28, tableRect.height);
  return {
    left: tableRect.left,
    right: tableRect.right,
    top: tableRect.top,
    bottom: tableRect.top + height,
    width: tableRect.width,
    height,
  };
}

export function isTableBlockHandleProximity(
  tableRect: BlockDragRect,
  point: BlockDropPoint,
): boolean {
  return (
    point.left >= tableRect.left - 72 &&
    point.left < tableRect.left - TABLE_AXIS_STRUCTURAL_OUTER_PROXIMITY &&
    point.top >= tableRect.top - 14 &&
    point.top <= Math.min(tableRect.bottom, tableRect.top + 42)
  );
}

interface ListItemDragContext {
  parent: ProseMirrorNode;
  parentPosition: number;
  parentStart: number;
}

function getListItemDragContext(
  editor: Editor,
  target: BlockDragTarget,
): ListItemDragContext | null {
  const { doc } = editor.state;
  const currentNode = doc.nodeAt(target.pos);
  if (
    !currentNode ||
    !currentNode.eq(target.node) ||
    !LIST_ITEM_NODE_TYPES.has(currentNode.type.name)
  ) {
    return null;
  }

  const $position = doc.resolve(target.pos);
  if ($position.depth < 1) return null;

  const parentDepth = $position.depth;
  const parent = $position.node(parentDepth);
  if (!LIST_CONTAINER_NODE_TYPES.has(parent.type.name)) return null;

  return {
    parent,
    parentPosition: $position.before(parentDepth),
    parentStart: $position.start(parentDepth),
  };
}

export function hasExceededBlockPointerDragThreshold(
  start: BlockDropPoint,
  current: BlockDropPoint,
): boolean {
  const horizontalDistance = current.left - start.left;
  const verticalDistance = current.top - start.top;
  return (
    horizontalDistance * horizontalDistance +
      verticalDistance * verticalDistance >=
    BLOCK_POINTER_DRAG_THRESHOLD * BLOCK_POINTER_DRAG_THRESHOLD
  );
}

export function getTopLevelBlockDragTargetFromDom(
  editor: Editor,
  dom: Node,
): BlockDragTarget | null {
  let position: number;
  try {
    position = editor.view.posAtDOM(dom, 0);
  } catch {
    return null;
  }

  if (position < 0 || position > editor.state.doc.content.size) return null;
  const $position = editor.state.doc.resolve(position);
  const topLevelPosition =
    $position.depth > 0 ? $position.before(1) : position;
  const node = editor.state.doc.nodeAt(topLevelPosition);
  if (!node) return null;

  const target = { node, pos: topLevelPosition };
  return isCurrentBlockDragTarget(editor, target) ? target : null;
}

export function isCurrentBlockDragTarget(
  editor: Editor,
  target: BlockDragTarget,
): boolean {
  const currentNode = editor.state.doc.nodeAt(target.pos);
  return Boolean(
    currentNode &&
      currentNode.eq(target.node) &&
      currentNode.type.name !== "frontmatter" &&
      editor.state.doc.resolve(target.pos).depth === 0,
  );
}

export function isCurrentMovableBlockDragTarget(
  editor: Editor,
  target: BlockDragTarget,
): boolean {
  return (
    isCurrentBlockDragTarget(editor, target) ||
    getListItemDragContext(editor, target) !== null
  );
}

function resolveListItemDropTarget(
  editor: Editor,
  target: BlockDragTarget,
  point: BlockDropPoint,
): ResolvedBlockDropTarget | null {
  const context = getListItemDragContext(editor, target);
  if (!context || context.parent.childCount < 2) return null;

  const editorRect = editor.view.dom.getBoundingClientRect();
  if (point.top < editorRect.top || point.top > editorRect.bottom) return null;

  const listDom = editor.view.nodeDOM(context.parentPosition);
  const listRect =
    listDom instanceof Element ? listDom.getBoundingClientRect() : editorRect;
  if (point.top < listRect.top || point.top > listRect.bottom) return null;

  const sourceEnd = target.pos + target.node.nodeSize;
  const candidates = new Map<
    number,
    { position: number; indicatorTop: number }
  >();

  context.parent.forEach((node, offset) => {
    const position = context.parentStart + offset;
    const nodeDom = editor.view.nodeDOM(position);
    if (!(nodeDom instanceof Element)) return;

    const rect = nodeDom.getBoundingClientRect();
    if (!Number.isFinite(rect.top) || !Number.isFinite(rect.bottom)) return;

    candidates.set(position, { position, indicatorTop: rect.top });
    candidates.set(position + node.nodeSize, {
      position: position + node.nodeSize,
      indicatorTop: rect.bottom,
    });
  });

  const closestCandidate = [...candidates.values()]
    .filter(
      (candidate) =>
        candidate.position < target.pos || candidate.position > sourceEnd,
    )
    .reduce<{ position: number; indicatorTop: number } | null>(
      (closest, candidate) => {
        if (!closest) return candidate;
        const candidateDistance = Math.abs(candidate.indicatorTop - point.top);
        const closestDistance = Math.abs(closest.indicatorTop - point.top);
        if (candidateDistance !== closestDistance) {
          return candidateDistance < closestDistance ? candidate : closest;
        }

        return point.top >= candidate.indicatorTop ? candidate : closest;
      },
      null,
    );
  if (!closestCandidate) return null;

  return {
    ...closestCandidate,
    indicatorLeft: listRect.left,
    indicatorWidth: listRect.width,
  };
}

function resolveTopLevelBlockBoundary(
  editor: Editor,
  point: BlockDropPoint,
  excludedStart: number,
  excludedEnd: number,
): ResolvedBlockDropTarget | null {
  const { doc } = editor.state;
  if (doc.childCount < 2) return null;

  const editorRect = editor.view.dom.getBoundingClientRect();
  if (point.top < editorRect.top || point.top > editorRect.bottom) return null;

  const candidates = new Map<
    number,
    { position: number; indicatorTop: number }
  >();

  doc.forEach((node, position) => {
    const nodeDom = editor.view.nodeDOM(position);
    if (!(nodeDom instanceof Element)) return;
    const rect = nodeDom.getBoundingClientRect();
    if (!Number.isFinite(rect.top) || !Number.isFinite(rect.bottom)) return;

    candidates.set(position, { position, indicatorTop: rect.top });
    candidates.set(position + node.nodeSize, {
      position: position + node.nodeSize,
      indicatorTop: rect.bottom,
    });
  });

  const closestCandidate = [...candidates.values()]
    .filter(
      (candidate) =>
        candidate.position < excludedStart || candidate.position > excludedEnd,
    )
    .reduce<{ position: number; indicatorTop: number } | null>(
      (closest, candidate) => {
        if (!closest) return candidate;
        const candidateDistance = Math.abs(candidate.indicatorTop - point.top);
        const closestDistance = Math.abs(closest.indicatorTop - point.top);
        if (candidateDistance !== closestDistance) {
          return candidateDistance < closestDistance ? candidate : closest;
        }

        return point.top >= candidate.indicatorTop ? candidate : closest;
      },
      null,
    );

  if (closestCandidate) {
    return {
      ...closestCandidate,
      indicatorLeft: editorRect.left,
      indicatorWidth: editorRect.width,
    };
  }

  const left = Math.max(
    editorRect.left + 1,
    Math.min(point.left, editorRect.right - 1),
  );
  const resolvedDrop = editor.view.posAtCoords({ left, top: point.top });
  if (!resolvedDrop) return null;

  const $drop = doc.resolve(resolvedDrop.pos);
  const targetIndex = Math.min($drop.index(0), doc.childCount - 1);
  let targetPosition = 0;
  for (let index = 0; index < targetIndex; index += 1) {
    targetPosition += doc.child(index).nodeSize;
  }

  const destinationNode = doc.child(targetIndex);
  const destinationDom = editor.view.nodeDOM(targetPosition);
  const destinationRect =
    destinationDom instanceof Element
      ? destinationDom.getBoundingClientRect()
      : null;
  const insertAfter =
    destinationRect !== null &&
    point.top >= destinationRect.top + destinationRect.height / 2;
  const position = insertAfter
    ? targetPosition + destinationNode.nodeSize
    : targetPosition;
  if (position >= excludedStart && position <= excludedEnd) return null;

  return {
    position,
    indicatorTop: destinationRect
      ? insertAfter
        ? destinationRect.bottom
        : destinationRect.top
      : point.top,
    indicatorLeft: editorRect.left,
    indicatorWidth: editorRect.width,
  };
}

export function resolveTopLevelBlockDropTarget(
  editor: Editor,
  target: BlockDragTarget,
  point: BlockDropPoint,
): ResolvedBlockDropTarget | null {
  if (!isCurrentBlockDragTarget(editor, target)) return null;
  const sourceEnd = target.pos + target.node.nodeSize;
  return resolveTopLevelBlockBoundary(editor, point, target.pos, sourceEnd);
}

export function resolveBlockDropTarget(
  editor: Editor,
  target: BlockDragTarget,
  point: BlockDropPoint,
): ResolvedBlockDropTarget | null {
  const listContext = getListItemDragContext(editor, target);
  if (listContext) {
    return (
      resolveListItemDropTarget(editor, target, point) ??
      resolveTopLevelBlockBoundary(
        editor,
        point,
        listContext.parentPosition,
        listContext.parentPosition + listContext.parent.nodeSize,
      )
    );
  }

  return resolveTopLevelBlockDropTarget(editor, target, point);
}

function moveBlockToResolvedTarget(
  editor: Editor,
  target: BlockDragTarget,
  resolvedTarget: ResolvedBlockDropTarget,
): boolean {
  const insertionPosition = resolvedTarget.position;
  const sourceEnd = target.pos + target.node.nodeSize;

  const listContext = getListItemDragContext(editor, target);
  const isInsertionInsideSourceList = Boolean(
    listContext &&
      insertionPosition >= listContext.parentStart &&
      insertionPosition <=
        listContext.parentStart + listContext.parent.content.size,
  );
  if (listContext && !isInsertionInsideSourceList) {
    const moveWholeList = listContext.parent.childCount === 1;
    const sourceStart = moveWholeList
      ? listContext.parentPosition
      : target.pos;
    const wrappedItem = listContext.parent.type.create(
      listContext.parent.attrs,
      target.node,
    );
    const transaction = editor.state.tr.delete(
      sourceStart,
      moveWholeList
        ? listContext.parentPosition + listContext.parent.nodeSize
        : sourceEnd,
    );
    const mappedInsertionPosition = transaction.mapping.map(
      insertionPosition,
      -1,
    );
    transaction.insert(mappedInsertionPosition, wrappedItem);
    transaction.setSelection(
      TextSelection.near(
        transaction.doc.resolve(
          Math.min(
            mappedInsertionPosition + 1,
            transaction.doc.content.size,
          ),
        ),
        1,
      ),
    );
    editor.view.dispatch(transaction.scrollIntoView());
    editor.view.focus();
    return true;
  }

  const transaction = editor.state.tr.delete(target.pos, sourceEnd);
  const mappedInsertionPosition = transaction.mapping.map(insertionPosition, -1);
  transaction.insert(mappedInsertionPosition, target.node);

  const selection =
    target.node.isAtom && NodeSelection.isSelectable(target.node)
      ? NodeSelection.create(transaction.doc, mappedInsertionPosition)
      : TextSelection.near(
          transaction.doc.resolve(
            Math.min(
              mappedInsertionPosition + 1,
              transaction.doc.content.size,
            ),
          ),
          1,
        );
  transaction.setSelection(selection);
  editor.view.dispatch(transaction.scrollIntoView());
  editor.view.focus();
  return true;
}

export function moveBlockByKeyboard(
  editor: Editor,
  target: BlockDragTarget,
  direction: -1 | 1,
): boolean {
  const listContext = getListItemDragContext(editor, target);
  const siblings: Array<{ node: ProseMirrorNode; pos: number }> = [];

  if (listContext) {
    listContext.parent.forEach((node, offset) => {
      siblings.push({ node, pos: listContext.parentStart + offset });
    });
  } else if (isCurrentBlockDragTarget(editor, target)) {
    editor.state.doc.forEach((node, pos) => siblings.push({ node, pos }));
  } else {
    return false;
  }

  const sourceIndex = siblings.findIndex(
    (sibling) => sibling.pos === target.pos && sibling.node.eq(target.node),
  );
  const destinationIndex = sourceIndex + direction;
  if (
    sourceIndex < 0 ||
    destinationIndex < 0 ||
    destinationIndex >= siblings.length
  ) {
    return false;
  }

  const destination = siblings[destinationIndex];
  const insertionPosition =
    direction < 0 ? destination.pos : destination.pos + destination.node.nodeSize;
  return moveBlockToResolvedTarget(editor, target, {
    position: insertionPosition,
    indicatorTop: 0,
    indicatorLeft: 0,
    indicatorWidth: 0,
  });
}

export function moveTopLevelBlockAtPoint(
  editor: Editor,
  target: BlockDragTarget,
  point: BlockDropPoint,
): boolean {
  const resolvedTarget = resolveTopLevelBlockDropTarget(editor, target, point);
  if (!resolvedTarget) return false;

  return moveBlockToResolvedTarget(editor, target, resolvedTarget);
}

export function moveBlockAtPoint(
  editor: Editor,
  target: BlockDragTarget,
  point: BlockDropPoint,
): boolean {
  const resolvedTarget = resolveBlockDropTarget(editor, target, point);
  if (!resolvedTarget) return false;

  return moveBlockToResolvedTarget(editor, target, resolvedTarget);
}
