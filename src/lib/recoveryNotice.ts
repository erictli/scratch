const STORAGE_KEY = "scratch:pendingRecoveryNotices";

export interface RecoveryNotice {
  recoveredTo: string;
  saveError: string;
  createdAt: string;
}

type RecoveryNoticeStorage = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
>;

function defaultStorage(): RecoveryNoticeStorage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

function readNotices(storage: RecoveryNoticeStorage): RecoveryNotice[] {
  const stored = storage.getItem(STORAGE_KEY);
  if (!stored) return [];
  const parsed: unknown = JSON.parse(stored);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(
    (notice): notice is RecoveryNotice =>
      typeof notice === "object" &&
      notice !== null &&
      typeof notice.recoveredTo === "string" &&
      typeof notice.saveError === "string" &&
      typeof notice.createdAt === "string",
  );
}

export function recordPendingRecoveryNotice(
  recoveredTo: string,
  saveError: unknown,
  storage: RecoveryNoticeStorage | undefined = defaultStorage(),
): void {
  if (!storage) throw new Error("Recovery notice storage is unavailable");
  const notices = readNotices(storage);
  notices.push({
    recoveredTo,
    saveError: String(saveError),
    createdAt: new Date().toISOString(),
  });
  storage.setItem(STORAGE_KEY, JSON.stringify(notices));
}

export function consumePendingRecoveryNotices(
  storage: RecoveryNoticeStorage | undefined = defaultStorage(),
): RecoveryNotice[] {
  if (!storage) return [];
  try {
    const notices = readNotices(storage);
    storage.removeItem(STORAGE_KEY);
    return notices;
  } catch {
    storage.removeItem(STORAGE_KEY);
    return [];
  }
}
