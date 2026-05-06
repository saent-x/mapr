/**
 * Auth utility — user profile creation on first sign-in.
 * Used by both the LoginPage component and backend admin operations.
 */

/**
 * Generates the InstantDB transaction steps to create a user profile on first sign-in.
 * Returns an array of transaction steps suitable for db.transact().
 *
 * @param {string} userId - The InstantDB user ID from auth
 * @param {string} email - The user's email address
 * @returns {Array} Transaction steps for db.transact()
 */
export function buildProfileCreationTxn(userId, email) {
  return {
    userId,
    email,
    displayName: email.split('@')[0],
    createdAt: Date.now(),
  };
}

/**
 * Generates the InstantDB transaction operations for creating a profile.
 * Accepts a transact helper object (db.tx) and returns the operations array.
 *
 * @param {object} tx - The db.tx object from InstantDB
 * @param {string} userId - The user ID
 * @param {string} email - The user's email
 * @returns {Array} Operations for db.transact()
 */
export function createProfileOps(tx, userId, email) {
  const profile = buildProfileCreationTxn(userId, email);
  return [
    tx.profiles[userId]
      .update({
        email: profile.email,
        displayName: profile.displayName,
        uid: profile.userId,
        createdAt: profile.createdAt,
      }),
  ];
}

/**
 * Determines if a profile was created during first sign-in.
 * The `created` flag comes from signInWithMagicCode response.
 *
 * @param {object} authResult - Result from signInWithMagicCode
 * @param {boolean} authResult.created - Whether this was a new user creation
 * @returns {boolean}
 */
export function isFirstSignIn(authResult) {
  return !!authResult?.created;
}
