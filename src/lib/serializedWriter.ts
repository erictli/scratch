export type SerializedWriter<T> = (value: T) => Promise<void>;
export type SerializedUpdater<T> = (
  update: (current: T) => T,
) => Promise<void>;
export type SerializedTaskQueue = <T>(task: () => Promise<T>) => Promise<T>;

export function createSerializedTaskQueue(): SerializedTaskQueue {
  let tail: Promise<void> = Promise.resolve();

  return <T>(task: () => Promise<T>): Promise<T> => {
    const result = tail.then(task);
    tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
}

/**
 * Serializes writes. Failures are reported through `onError` only. The
 * returned promise always fulfills, so callers cannot detect a failed write.
 * Use `createSerializedTaskQueue` when the caller must observe rejections.
 */
export function createSerializedWriter<T>(
  write: (value: T) => Promise<void>,
  onError: (error: unknown) => void = () => {},
): SerializedWriter<T> {
  let queue = Promise.resolve();

  return (value: T) => {
    queue = queue.then(() => write(value)).catch(onError);
    return queue;
  };
}

export function createSerializedUpdater<T>(
  read: () => Promise<T>,
  write: (value: T) => Promise<void>,
  onError: (error: unknown) => void = () => {},
): SerializedUpdater<T> {
  return createSerializedWriter(async (update: (current: T) => T) => {
    const current = await read();
    await write(update(current));
  }, onError);
}
