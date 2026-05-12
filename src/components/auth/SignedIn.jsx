import React from 'react';
import db from '../../services/instantDb';

/**
 * Renders children only when the user is authenticated.
 * Usage: <SignedIn><ProtectedContent /></SignedIn>
 */
export default function SignedIn({ children }) {
  const { user, isLoading } = db.useAuth();

  if (isLoading) return null;
  if (!user) return null;

  return <>{children}</>;
}
