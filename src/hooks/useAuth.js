import { useCallback } from 'react';
import db from '../services/instantDb';

/**
 * Convenience hook wrapping InstantDB useAuth with additional helpers.
 * Returns { user, isLoading, error, sendMagicCode, signInWithCode, signOut }
 */
export default function useAuth() {
  const { user, isLoading, error } = db.useAuth();

  const sendMagicCode = useCallback(
    (email) => db.auth.sendMagicCode({ email }),
    [],
  );

  const signInWithCode = useCallback(
    (email, code) => db.auth.signInWithMagicCode({ email, code }),
    [],
  );

  const signOut = useCallback(() => db.auth.signOut(), []);

  return {
    user,
    isLoading,
    error,
    sendMagicCode,
    signInWithCode,
    signOut,
  };
}
