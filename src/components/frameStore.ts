export type StoredFrame = { blob: Blob; capturedAt: Date; endedAt?: Date };

type FrameRecord = StoredFrame & { cameraId: string };

const DB_NAME = "pantaujalur";
const STORE = "frames";

const memory = new Map<string, StoredFrame>();
let database: IDBDatabase | null = null;

async function open(): Promise<IDBDatabase> {
  if (database) return database;
  const request = indexedDB.open(DB_NAME, 1);
  request.onupgradeneeded = () =>
    request.result.createObjectStore(STORE, { keyPath: "cameraId" });
  database = await settle(request);
  return database;
}

function settle<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export const frameStore = {
  async load(cameraIds: string[]): Promise<Map<string, StoredFrame>> {
    const frames = new Map<string, StoredFrame>();
    try {
      const store = (await open())
        .transaction(STORE, "readonly")
        .objectStore(STORE);
      const records = await Promise.all(
        cameraIds.map((id) => settle<FrameRecord | undefined>(store.get(id))),
      );
      for (const record of records)
        if (record)
          frames.set(record.cameraId, {
            blob: record.blob,
            capturedAt: record.capturedAt,
            endedAt: record.endedAt,
          });
    } catch (error) {
      void error;
    }
    for (const [id, frame] of memory) {
      const stored = frames.get(id);
      if (
        cameraIds.includes(id) &&
        (!stored || stored.capturedAt < frame.capturedAt)
      )
        frames.set(id, frame);
    }
    return frames;
  },

  async save(cameraId: string, frame: StoredFrame): Promise<void> {
    memory.set(cameraId, frame);
    try {
      const record: FrameRecord = { cameraId, ...frame };
      await settle(
        (await open())
          .transaction(STORE, "readwrite")
          .objectStore(STORE)
          .put(record),
      );
    } catch (error) {
      void error;
    }
  },
};

const FAILURES_KEY = "pantaujalur:offline";

export const failureStore = {
  load(): Map<string, Date> {
    try {
      const raw: unknown = JSON.parse(
        localStorage.getItem(FAILURES_KEY) ?? "{}",
      );
      if (typeof raw !== "object" || raw === null) return new Map();
      return new Map(
        Object.entries(raw)
          .filter(
            (entry): entry is [string, number] => typeof entry[1] === "number",
          )
          .map(([id, at]) => [id, new Date(at)]),
      );
    } catch {
      return new Map();
    }
  },

  save(cameraId: string, at: Date | null): void {
    try {
      const failures = Object.fromEntries(
        [...failureStore.load()].map(([id, date]) => [id, date.getTime()]),
      );
      if (at) failures[cameraId] = at.getTime();
      else delete failures[cameraId];
      localStorage.setItem(FAILURES_KEY, JSON.stringify(failures));
    } catch (error) {
      void error;
    }
  },
};
