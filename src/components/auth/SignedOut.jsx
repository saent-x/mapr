import React from 'react';
import db from '../../services/instantDb';

/**
 * Renders children only when the user is NOT authenticated.
 * Usage: <SignedOut><LoginPrompt /></SignedOut>
 */
export default function SignedOut({ children }) {
  const { user, isLoading } = db.useAuth();

  if (isLoading) return null;
  if (user) return null;

  return <>{children}</>;
}
