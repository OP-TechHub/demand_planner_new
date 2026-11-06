/**
 * Offline copies of the planner's pages, kept in this browser's IndexedDB.
 *
 * Decisions (made with the business, see docs/user-manual-*):
 *   • Every data page keeps a copy; admin and auth pages do not (offline-routes.ts).
 *   • Saved automatically on every online visit to the page.
 *   • Never expires — the offline screen shows when the copy was saved instead.
 *   • Holds exactly what the user saw online: the server already shaped the
 *     props to their role and grants, so the copy is shaped the same way.
 *   • View-only offline: every entry's readOnly() transform strips the edit
 *     affordances before the copy is rendered (app/offline/entries/*).
 *   • Deleted on sign-out, and when a different user signs in on the device.
 *
 * Why IndexedDB and not the service worker's Cache Storage: the worker's caches
 * hold only static, user-agnostic files. These copies are one user's data, and
 * they must be removable on sign-out without touching anything else.
 *
 * Records in the one store:
 *   page:<route>  — the full snapshot (schema, savedAt, user, props)
 *   meta:<route>  — just { savedAt, userName }, so listing the copies on the
 *                   offline screen never loads megabytes of props
 *   owner         — { userId } of whoever the copies belong to
 *
 * Browser-only. Every function resolves quietly when IndexedDB is unavailable
 * (private windows on some browsers): offline use is an extra, never a blocker.
 */

const DB_NAME = 'op-offline';
const DB_VERSION = 1;
const STORE = 'snapshots';
const PAGE_PREFIX = 'page:';
const META_PREFIX = 'meta:';
const OWNER_KEY = 'owner';

export type OfflineSnapshot<T> = {
  schema: number;
  savedAt: string;
  userId: string;
  userName: string;
  props: T;
};

export type SavedPage = { route: string; savedAt: string; userName: string };

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

/** Run `use` inside one transaction; resolves null on any failure. */
function tx<R>(mode: IDBTransactionMode, use: (store: IDBObjectStore) => IDBRequest<R> | void): Promise<R | null> {
  return openDb().then((db) => {
    if (!db) return null;
    return new Promise<R | null>((resolve) => {
      try {
        const t = db.transaction(STORE, mode);
        const req = use(t.objectStore(STORE));
        t.oncomplete = () => { db.close(); resolve(req ? req.result ?? null : null); };
        t.onerror = () => { db.close(); resolve(null); };
        t.onabort = () => { db.close(); resolve(null); };
      } catch {
        db.close();
        resolve(null);
      }
    });
  });
}

/** Store (or replace) this user's copy of one page. */
export async function savePageSnapshot<T>(route: string, schema: number, props: T, user: { id: string; name: string }): Promise<void> {
  const snap: OfflineSnapshot<T> = {
    schema,
    savedAt: new Date().toISOString(),
    userId: user.id,
    userName: user.name,
    props,
  };
  await tx('readwrite', (s) => {
    s.put(snap, PAGE_PREFIX + route);
    s.put({ savedAt: snap.savedAt, userName: snap.userName }, META_PREFIX + route);
    s.put({ userId: user.id }, OWNER_KEY);
  });
}

/** The saved copy of `route`, or null when there is none this build can read. */
export async function loadPageSnapshot<T>(route: string, schema: number): Promise<OfflineSnapshot<T> | null> {
  const snap = (await tx('readonly', (s) => s.get(PAGE_PREFIX + route))) as OfflineSnapshot<T> | null;
  if (!snap || snap.schema !== schema) return null;
  return snap;
}

/** Which pages have a copy on this device, without loading any of them. */
export async function listSavedPages(): Promise<SavedPage[]> {
  const range = IDBKeyRange.bound(META_PREFIX, META_PREFIX + '￿');
  const [keys, values] = await Promise.all([
    tx('readonly', (s) => s.getAllKeys(range)),
    tx('readonly', (s) => s.getAll(range)),
  ]);
  if (!keys || !values || keys.length !== values.length) return [];
  return keys.map((k, i) => {
    const v = values[i] as { savedAt?: string; userName?: string };
    return { route: String(k).slice(META_PREFIX.length), savedAt: v?.savedAt ?? '', userName: v?.userName ?? '' };
  });
}

/** Wipe every offline copy on this device. Used on sign-out. */
export async function clearOfflineData(): Promise<void> {
  await tx('readwrite', (s) => s.clear());
}

/**
 * Wipe the copies if they belong to someone other than `userId` (another
 * account signed in here). Copies from builds before the owner record existed
 * have no way to prove whose they are, so they are wiped too.
 */
export async function clearIfOtherUser(userId: string): Promise<void> {
  const owner = (await tx('readonly', (s) => s.get(OWNER_KEY))) as { userId?: string } | null;
  if (owner) {
    if (owner.userId !== userId) await clearOfflineData();
    return;
  }
  const count = (await tx('readonly', (s) => s.count())) ?? 0;
  if (count > 0) await clearOfflineData();
}

/**
 * Ask the service worker to check that the offline pages and their code are
 * cached for the current build, so the saved copies can open with no
 * connection. Fire-and-forget.
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
