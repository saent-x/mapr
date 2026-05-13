/**
 * InstantDB Schema — MAPR
 *
 * Apply via:
 *   npx instant-cli@latest push schema
 *
 * Layout follows the InstantDB docs exactly:
 *   - Entities declare scalar fields only
 *   - Relationships go in the dedicated `links` block
 *   - `$users.email` is `i.any().unique().indexed()` for legacy owner-link
 *     fallbacks; client writes prefer the authenticated `$users` UUID when it
 *     is available.
 */

import { i } from '@instantdb/core';

const _schema = i.schema({
  entities: {
    /**
     * Built-in InstantDB users entity. Only fields that need to be on
     * the row appear here — InstantDB handles auth fields itself.
     *
     * `subscriptionStatus` and `stripeCustomerId` are server-of-record:
     * the perms file below blocks all client writes; only the Stripe
     * webhook (running with the admin token) may mutate them.
     */
    $users: i.entity({
      email: i.any().unique().indexed(),
      subscriptionStatus: i.string().optional(),
      stripeCustomerId: i.string().optional(),
    }),

    profiles: i.entity({
      displayName: i.string(),
      email: i.string(),
      createdAt: i.number(),
      uid: i.string().unique().indexed(),
    }),

    savedViews: i.entity({
      name: i.string(),
      description: i.string().optional(),
      tags: i.json().optional(),
      pinned: i.boolean().optional(),
      lastOpenedAt: i.number().optional(),
      filterState: i.json(),
      mapState: i.json(),
      createdAt: i.number(),
      updatedAt: i.number(),
      shareToken: i.string().optional().indexed(),
      sharedAt: i.number().optional(),
      shareViewCount: i.number().optional(),
    }),

    alertRules: i.entity({
      name: i.string(),
      severityThreshold: i.number(),
      minConfidence: i.number().optional(),
      deliveryMode: i.string().optional(),
      quietHours: i.json().optional(),
      channels: i.json().optional(),
      lastTriggeredAt: i.number().optional(),
      savedViewId: i.string(),
      active: i.boolean(),
      createdAt: i.number(),
      digestSchedule: i.json().optional(),
      lastDigestSentAt: i.number().optional(),
      emailAddress: i.string().optional(),
    }),

    watchlistItems: i.entity({
      type: i.string(),
      value: i.string(),
      label: i.string(),
      addedAt: i.number(),
      lastMatchAt: i.number().optional(),
      matchCount: i.number().optional(),
    }),

    // AI Q&A sidebar — owned by the user. Messages are server-only writes
    // (see instant.perms.ts) so the agent can't be hijacked client-side.
    qaConversations: i.entity({
      title: i.string(),
      createdAt: i.number(),
      updatedAt: i.number(),
      archived: i.boolean().optional(),
      lastMessageAt: i.number().optional(),
      messageCount: i.number().optional(),
      useCurrentFilters: i.boolean().optional(),
    }),

    qaMessages: i.entity({
      conversationId: i.string().indexed(),
      role: i.string(),
      content: i.string(),
      citations: i.json().optional(),
      modelUsed: i.string().optional(),
      tokensIn: i.number().optional(),
      tokensOut: i.number().optional(),
      createdAt: i.number().indexed(),
    }),

    bookmarks: i.entity({
      storyId: i.string(),
      storyTitle: i.string(),
      storySummary: i.string().optional(),
      source: i.string().optional(),
      url: i.string().optional(),
      note: i.string().optional(),
      tags: i.json().optional(),
      status: i.string().optional(),
      priority: i.string().optional(),
      region: i.string(),
      severity: i.number(),
      bookmarkedAt: i.number(),
      updatedAt: i.number().optional(),
    }),

    subscriptions: i.entity({
      stripeSubscriptionId: i.string(),
      stripeCustomerId: i.string(),
      status: i.string(),
      tier: i.string(),
      currentPeriodEnd: i.number(),
      cancelAtPeriodEnd: i.boolean(),
      createdAt: i.number(),
    }),
  },

  // All relationships live here. The forward side is what we link FROM
  // in transactions (`db.tx.savedViews[id].link({ owner: ... })`); the
  // reverse side is what `auth.ref('$user.savedViews.id')` traverses
  // in perm checks.
  links: {
    userSavedViews: {
      forward: { on: 'savedViews', has: 'one', label: 'owner' },
      reverse: { on: '$users', has: 'many', label: 'savedViews' },
    },
    userAlertRules: {
      forward: { on: 'alertRules', has: 'one', label: 'owner' },
      reverse: { on: '$users', has: 'many', label: 'alertRules' },
    },
    userBookmarks: {
      forward: { on: 'bookmarks', has: 'one', label: 'owner' },
      reverse: { on: '$users', has: 'many', label: 'bookmarks' },
    },
    userSubscriptions: {
      forward: { on: 'subscriptions', has: 'one', label: 'owner' },
      reverse: { on: '$users', has: 'many', label: 'subscriptions' },
    },
    userWatchlistItems: {
      forward: { on: 'watchlistItems', has: 'one', label: 'owner' },
      reverse: { on: '$users', has: 'many', label: 'watchlistItems' },
    },
    userQaConversations: {
      forward: { on: 'qaConversations', has: 'one', label: 'owner' },
      reverse: { on: '$users', has: 'many', label: 'qaConversations' },
    },
  },
});

type _AppSchema = typeof _schema;
interface AppSchema extends _AppSchema {}
const schema: AppSchema = _schema;

export type { AppSchema };
export default schema;
