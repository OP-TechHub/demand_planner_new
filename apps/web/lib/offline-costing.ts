/**
 * The offline copy of the Cost Grid, kept in this browser's IndexedDB.
 *
 * Decisions (made with the business, see docs/user-manual-*):
 *   • Cost Grid only. Saved automatically on every online visit to Costing.
 *   • Never expires — the grid shows when the copy was saved instead.
 *   • Holds exactly what the user saw online: the server already masks the
 *     base cost for users without the view grant, so the copy is masked too.
 *   • Deleted on sign-out, and when a different user signs in on the device.
 *
 * Why IndexedDB and not the service worker's Cache Storage: the worker's caches
 * hold only static, user-agnostic files. This copy is one user's data, and it
 * must be removable on sign-out without touching anything else.
 *
 * Browser-only. Every function resolves quietly when IndexedDB is unavailable
 * (private windows on some browsers): offline use is an extra, never a blocker.
 */

const DB_NAME = 'op-offline';
const DB_VERSION = 1;
const STORE = 'snapshots';
const COST_GRID_KEY = 'cost-grid';

/**
 * Bumped whenever the Cost Grid's props change shape, so a copy saved by an
 * older build is ignored rather than handed to a grid that cannot read it.
 * The copy is re-saved on the next online visit anyway.
 */
export const COST_GRID_SCHEMA = 1;

export type OfflineSnapshot<T> = {
  schema: number;
  savedAt: string;
  userId: string;
  userName: string;
  props: T;
};

function hasIdb(): boolean {
  return typeof indexedDB !== 'undefined';
}

function openDb(): Promise<IDBDatabase | null> {
  if (!hasIdb()) return Promise.resolve(null);
  return new Promise((resolve) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
}

async function tx<R>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<R>): Promise<R | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const t = db.transaction(STORE, mode);
      const req = run(t.objectStore(STORE));
      t.oncomplete = () => { db.close(); resolve(req.result ?? null); };
      t.onerror = () => { db.close(); resolve(null); };
      t.onabort = () => { db.close(); resolve(null); };
    } catch {
      db.close();
      resolve(null);
    }
  });
}

/** Store (or replace) this user's Cost Grid copy. */
export async function saveCostGridSnapshot<T>(props: T, user: { id: string; name: string }): Promise<void> {
  const snap: OfflineSnapshot<T> = {
    schema: COST_GRID_SCHEMA,
    savedAt: new Date().toISOString(),
    userId: user.id,
    userName: user.name,
    props,
  };
  await tx('readwrite', (s) => s.put(snap, COST_GRID_KEY));
}

/** The saved Cost Grid copy, or null when there is none this build can read. */
export async function loadCostGridSnapshot<T>(): Promise<OfflineSnapshot<T> | null> {
  const snap = (await tx('readonly', (s) => s.get(COST_GRID_KEY))) as OfflineSnapshot<T> | null;
  if (!snap || snap.schema !== COST_GRID_SCHEMA) return null;
  return snap;
}

/** Just enough to say whether a copy exists and how old it is, without loading the grid. */
export async function peekCostGridSnapshot(): Promise<{ savedAt: string; userName: string } | null> {
  const snap = await loadCostGridSnapshot<unknown>();
  return snap ? { savedAt: snap.savedAt, userName: snap.userName } : null;
}

/** Wipe every offline copy on this device. Used on sign-out. */
export async function clearOfflineData(): Promise<void> {
  await tx('readwrite', (s) => s.clear());
}

/** Wipe the copy if it belongs to someone other than `userId` (another account signed in here). */
export async function clearIfOtherUser(userId: string): Promise<void> {
  const snap = (await tx('readonly', (s) => s.get(COST_GRID_KEY))) as OfflineSnapshot<unknown> | null;
  if (snap && snap.userId !== userId) await clearOfflineData();
}

/**
 * Ask the service worker to (re)cache the offline pages and their code, so the
 * saved grid can open with no connection. Fire-and-forget.
 */
export function requestOfflinePagesCache(): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  navigator.serviceWorker.ready
    .then((reg) => reg.active?.postMessage({ type: 'cache-offline-pages' }))
    .catch(() => {});
}

/** "06 Nov 2026, 14:05" in the viewer's locale. */
export function formatSavedAt(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
}
