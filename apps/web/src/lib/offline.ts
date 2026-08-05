const DB_NAME = "stocksense-offline";
const DB_VERSION = 1;
const STORE = "snapshots";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function cacheSnapshot<T>(key: string, data: T): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put({ data, savedAt: new Date().toISOString() }, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    /* ignore quota / private mode */
  }
}

export async function readSnapshot<T>(
  key: string
): Promise<{ data: T; savedAt: string } | null> {
  try {
    const db = await openDb();
    const row = await new Promise<{ data: T; savedAt: string } | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return row || null;
  } catch {
    return null;
  }
}

export function isProbablyOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}
