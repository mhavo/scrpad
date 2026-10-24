// The notes in this browser's IndexedDB (one record: the stored state from notes.js toStored).
// Nothing leaves the device: no request is ever made with the notes.

const DB = "scrpad";
const STORE = "kv";
const KEY = "state";

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

let db;
const handle = async () => (db ??= await open());

export async function load() {
  const d = await handle();
  return new Promise((resolve, reject) => {
    const req = d.transaction(STORE).objectStore(STORE).get(KEY);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

/** Resolves once the write is durable in the transaction's sense, rejects otherwise. */
export async function save(stored) {
  const d = await handle();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(stored, KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("save aborted"));
  });
}

/** Keeps a stored state this version cannot read under a key of its own, never to be overwritten. */
export async function keepAside(raw) {
  const d = await handle();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(raw, `unreadable-${new Date().toISOString()}`);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Asks the browser not to evict the notes under storage pressure; false if it declines. */
export async function persist() {
  try {
    return (await navigator.storage?.persisted?.()) || (await navigator.storage?.persist?.()) || false;
  } catch {
    return false;
  }
}
