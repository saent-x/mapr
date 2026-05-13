/**
 * Shared InstantDB client initialization.
 * Uses VITE_INSTANT_APP_ID from environment (Vite prefix for client-side access).
 */
import { init } from '@instantdb/react';

const APP_ID = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_INSTANT_APP_ID) || '';

if (!APP_ID && typeof window !== 'undefined') {
  console.warn('[mapr] VITE_INSTANT_APP_ID not set — InstantDB auth disabled');
}

export const db = init({ appId: APP_ID });

export default db;
