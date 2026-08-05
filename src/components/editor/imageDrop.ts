const SUPPORTED_IMAGE_EXTENSIONS = new Set([
  "jpg",
  "jpeg",
  "png",
  "gif",
  "webp",
  "svg",
  "bmp",
  "tiff",
  "tif",
  "ico",
  "avif",
]);

export interface DropPoint {
  x: number;
  y: number;
}

export interface DropRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function isPointInsideRect(
  point: DropPoint,
  rect: DropRect,
): boolean {
  return (
    point.x >= rect.left &&
    point.x <= rect.right &&
    point.y >= rect.top &&
    point.y <= rect.bottom
  );
}

export interface ImageDropBlock {
  before: number;
  after: number;
  top: number;
  bottom: number;
}

export interface ImageDropTarget {
  position: number;
  top: number;
}

interface ImageDropAdapters {
  copyImageToAssets: (sourcePath: string) => Promise<string>;
  resolveAssetUrl: (relativePath: string) => Promise<string>;
  insertImage: (src: string, position: number) => void;
  onError?: (sourcePath: string, error: unknown) => void;
}

interface ScaleFactorRef {
  current: number;
}

function normalizeScaleFactor(scaleFactor: number): number {
  return Number.isFinite(scaleFactor) && scaleFactor > 0 ? scaleFactor : 1;
}

export function createImageDragScaleFactorController(
  scaleFactorRef: ScaleFactorRef,
  loadScaleFactor: () => Promise<number>,
) {
  let generation = 0;
  let pendingLookup: Promise<number | null> | null = null;

  return {
    enter(): Promise<number | null> {
      if (pendingLookup) return pendingLookup;
      const lookupGeneration = generation;
      let loadedScaleFactor: Promise<number>;
      try {
        loadedScaleFactor = loadScaleFactor();
      } catch {
        loadedScaleFactor = Promise.resolve(1);
      }
      pendingLookup = loadedScaleFactor
        .then(normalizeScaleFactor)
        .catch(() => 1)
        .then((scaleFactor) => {
          if (generation !== lookupGeneration) {
            return null;
          }
          scaleFactorRef.current = scaleFactor;
          return scaleFactor;
        });
      return pendingLookup;
    },
    current(): number {
      return normalizeScaleFactor(scaleFactorRef.current);
    },
    reset(): void {
      generation += 1;
      pendingLookup = null;
      scaleFactorRef.current = 1;
    },
  };
}

export function filterSupportedImagePaths(paths: string[]): string[] {
  return paths.filter((path) => {
    const filename = path.split(/[\\/]/).pop() ?? "";
    const extension = filename.match(/\.([^.]+)$/)?.[1]?.toLowerCase();
    return Boolean(extension && SUPPORTED_IMAGE_EXTENSIONS.has(extension));
  });
}

export function physicalToLogicalPoint(
  position: DropPoint,
  scaleFactor: number,
): DropPoint {
  const safeScaleFactor = normalizeScaleFactor(scaleFactor);
  return {
    x: position.x / safeScaleFactor,
    y: position.y / safeScaleFactor,
  };
}

export function resolveImageDropPosition(
  point: DropPoint,
  editorRect: DropRect,
  posAtCoords: (coords: { left: number; top: number }) =>
    | { pos: number }
    | null,
  fallbackPosition: number,
  minimumPosition = 0,
): number | null {
  if (!isPointInsideRect(point, editorRect)) return null;
  const resolvedPosition =
    posAtCoords({ left: point.x, top: point.y })?.pos ?? fallbackPosition;
  return Math.max(minimumPosition, resolvedPosition);
}

export function resolveBlockDropTarget(
  point: DropPoint,
  editorRect: DropRect,
  blocks: ImageDropBlock[],
  fallbackPosition: number,
  minimumPosition = 0,
): ImageDropTarget | null {
  if (!isPointInsideRect(point, editorRect)) return null;

  const candidates: ImageDropTarget[] = [];
  blocks.forEach((block, index) => {
    if (index === 0) {
      candidates.push({ position: block.before, top: block.top });
    }

    const nextBlock = blocks[index + 1];
    if (nextBlock) {
      candidates.push({
        position: nextBlock.before,
        top: (block.bottom + nextBlock.top) / 2,
      });
    } else {
      candidates.push({ position: block.after, top: block.bottom });
    }
  });

  const validCandidates = candidates.filter(
    (candidate) => candidate.position >= minimumPosition,
  );
  const closestCandidate = validCandidates.reduce<ImageDropTarget | null>(
    (closest, candidate) => {
      if (!closest) return candidate;
      return Math.abs(candidate.top - point.y) <
        Math.abs(closest.top - point.y)
        ? candidate
        : closest;
    },
    null,
  );

  return (
    closestCandidate ?? {
      position: Math.max(minimumPosition, fallbackPosition),
      top: point.y,
    }
  );
}

export function resolveEditorBlockDropTarget(
  point: DropPoint,
  editorRect: DropRect,
  dropSurfaceRect: DropRect | null,
  blocks: ImageDropBlock[],
  fallbackPosition: number,
  minimumPosition = 0,
): ImageDropTarget | null {
  const surfaceRect = dropSurfaceRect ?? editorRect;

  return resolveBlockDropTarget(
    point,
    {
      left: surfaceRect.left,
      right: surfaceRect.right,
      top: Math.min(surfaceRect.top, editorRect.top),
      bottom: Math.max(surfaceRect.bottom, editorRect.bottom),
    },
    blocks,
    fallbackPosition,
    minimumPosition,
  );
}

export async function importDroppedImagePaths(
  paths: string[],
  insertionPosition: number,
  adapters: ImageDropAdapters,
): Promise<{ imported: number; failed: number }> {
  const imagePaths = filterSupportedImagePaths(paths);
  let nextPosition = insertionPosition;
  let imported = 0;
  let failed = 0;

  for (const sourcePath of imagePaths) {
    try {
      const relativePath = await adapters.copyImageToAssets(sourcePath);
      const assetUrl = await adapters.resolveAssetUrl(relativePath);
      adapters.insertImage(assetUrl, nextPosition);
      nextPosition += 1;
      imported += 1;
    } catch (error) {
      failed += 1;
      adapters.onError?.(sourcePath, error);
    }
  }

  return { imported, failed };
}
