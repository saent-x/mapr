/**
 * InstantDB permissions — MAPR
 *
 * Apply via:
 *   npx instant-cli@latest push perms
 *
 * Owner-check pattern follows the InstantDB docs:
 *   - `auth.ref('$user.<linkLabel>.id')` traverses from the auth user
 *     to their owned rows (uses the `links` block in instant.schema.ts).
 *   - `auth.id in data.ref('owner.id')` is the canonical way to check
 *     "the entity I'm creating/touching belongs to me".
 *
 * `$users.subscriptionStatus` and `$users.stripeCustomerId` are
 * server-of-record: only the admin SDK (Stripe webhook) writes them.
 */

import type { InstantRules } from '@instantdb/core';

const rules = {
  $users: {
    allow: {
      view: 'auth.id != null && auth.id == data.id',
      create: 'false',
      update: 'false',
      delete: 'false',
    },
  },

  profiles: {
    bind: {
      isOwner: 'auth.id != null && auth.id == data.uid',
    },
    allow: {
      view: 'isOwner',
      create: 'auth.id != null && newData.uid == auth.id',
      update: 'isOwner && newData.uid == data.uid',
      delete: 'isOwner',
    },
  },

  savedViews: {
    bind: {
      isOwner: "data.id in auth.ref('$user.savedViews.id')",
      isShared: "data.shareToken != null && data.shareToken != ''",
    },
    allow: {
      view: 'isOwner || isShared',
      create: "auth.id in data.ref('owner.id')",
      update: 'isOwner',
      delete: 'isOwner',
    },
  },

  watchlistItems: {
    bind: {
      isOwner: "data.id in auth.ref('$user.watchlistItems.id')",
    },
    allow: {
      view: 'isOwner',
      create: "auth.id in data.ref('owner.id')",
      update: 'isOwner',
      delete: 'isOwner',
    },
  },

  // AI Q&A conversations live in the user's account. Reads/writes via
  // the regular owner check; the server (admin token) also writes
  // through them when appending messages.
  qaConversations: {
    bind: {
      isOwner: "data.id in auth.ref('$user.qaConversations.id')",
    },
    allow: {
      view: 'isOwner',
      create: "auth.id in data.ref('owner.id')",
      update: 'isOwner',
      delete: 'isOwner',
    },
  },

  // Messages are server-owned. Clients NEVER write them directly so the
  // agent can't be hijacked or have its citations forged client-side.
  // Reads also go through the server route, which authorizes the user
  // against the parent conversation before returning rows.
  qaMessages: {
    allow: {
      view: 'false',
      create: 'false',
      update: 'false',
      delete: 'false',
    },
  },

  alertRules: {
    bind: {
      isOwner: "data.id in auth.ref('$user.alertRules.id')",
    },
    allow: {
      view: 'isOwner',
      create: "auth.id in data.ref('owner.id')",
      update: 'isOwner',
      delete: 'isOwner',
    },
  },

  bookmarks: {
    bind: {
      isOwner: "data.id in auth.ref('$user.bookmarks.id')",
    },
    allow: {
      view: 'isOwner',
      create: "auth.id in data.ref('owner.id')",
      update: 'isOwner',
      delete: 'isOwner',
    },
  },

  subscriptions: {
    bind: {
      isOwner: "data.id in auth.ref('$user.subscriptions.id')",
    },
    allow: {
      view: 'isOwner',
      create: 'false',
      update: 'false',
      delete: 'false',
    },
  },
} satisfies InstantRules;

export default rules;
