import { useCallback, useEffect } from 'react';
import { id } from '@instantdb/react';
import db from '../services/instantDb';
import { getUserOwnerRef, getUserOwnerWhere } from '../utils/instantUser';
import useWatchStore from '../stores/watchStore';

const SYNC_FLAG_KEY = 'mapr_watchlist_synced_v1';

function safeRead() {
  if (typeof window === 'undefined') return null;
  try { return window.localStorage.getItem(SYNC_FLAG_KEY); }
  catch { return null; }
}
function safeWrite(value) {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(SYNC_FLAG_KEY, value); }
  catch { /* quota */ }
}

/**
 * useWatchlistSync — bridges the legacy localStorage watchlist with InstantDB.
 *
 * Responsibilities:
 *   1. Query the user's `watchlistItems` from InstantDB while signed in.
 *   2. On first run after sign-in, push any local-only items into the DB
 *      (one-shot migration; guarded by a localStorage flag).
 *   3. Return helpers for creating/removing items in the DB.
 *
 * Consumers (WatchlistPanel et al.) can continue reading from the legacy
 * store; this hook keeps the DB in sync so devices share the same set.
 * A future sprint will flip the source-of-truth fully to InstantDB.
 */
export default function useWatchlistSync() {
  const auth = db.useAuth();
  const user = auth.user;

  const { data, isLoading, error } = db.useQuery(
    user ? { watchlistItems: { $: { where: getUserOwnerWhere(user) } } } : null,
  );

  const dbItems = data?.watchlistItems || [];
  const localItems = useWatchStore((s) => s.watchItems);

  // One-shot migration: push local items into DB once per user.
  useEffect(() => {
    if (!user || isLoading || error) return;
    const flag = safeRead();
    const alreadySynced = flag && flag === user.id;
    if (alreadySynced) return;

    const existingKeys = new Set(dbItems.map((i) => `${i.type}|${i.value.toLowerCase()}`));
    const ops = [];
    for (const item of localItems) {
      const key = `${item.type}|${item.value.toLowerCase()}`;
      if (existingKeys.has(key)) continue;
      const itemId = id();
      ops.push(
        db.tx.watchlistItems[itemId]
          .update({
            type: item.type,
            value: item.value,
            label: item.label || item.value,
            addedAt: typeof item.addedAt === 'string' ? new Date(item.addedAt).getTime() : (item.addedAt || Date.now()),
            matchCount: 0,
          })
          .link({ owner: getUserOwnerRef(user) }),
      );
    }
    const apply = ops.length ? db.transact(ops) : Promise.resolve();
    apply
      .then(() => safeWrite(user.id))
      .catch((err) => console.warn('watchlist sync push failed', err.message));
  }, [user, isLoading, error, dbItems.length, localItems.length]);

  const addItem = useCallback(
    async ({ type, value, label }) => {
      if (!user) return null;
      const norm = String(value || '').trim();
      if (!type || !norm) return null;
      const exists = dbItems.find((i) => i.type === type && i.value.toLowerCase() === norm.toLowerCase());
      if (exists) return exists.id;
      const itemId = id();
      await db.transact(
        db.tx.watchlistItems[itemId]
          .update({
            type,
            value: norm,
            label: (label || norm).trim(),
            addedAt: Date.now(),
            matchCount: 0,
          })
          .link({ owner: getUserOwnerRef(user) }),
      );
      return itemId;
    },
    [user, dbItems],
  );

  const removeItem = useCallback(
    async (itemId) => {
      if (!user || !itemId) return;
      await db.transact(db.tx.watchlistItems[itemId].delete());
    },
    [user],
  );

  return {
    isAuthenticated: Boolean(user),
    isLoading: auth.isLoading || isLoading,
    error,
    dbItems,
    addItem,
    removeItem,
  };
}
