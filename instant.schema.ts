/**
 * InstantDB Schema — MAPR v5
 *
 * Defines the data model for all InstantDB entities.
 * Run `npx instant-cli push-schema` or use the Dashboard to apply.
 */

import { i } from '@instantdb/core';

const _schema = i.schema({
  entities: {
    /**
     * Built-in InstantDB users entity.
     * Extended with custom attributes for MAPR-specific data.
     */
    $users: i.entity({
      email: i.string().unique(),
      createdAt: i.date(),
      /** Subscription tier: 'free' | 'pro' | 'enterprise' */
      subscriptionStatus: i.string(),
      /** Stripe customer ID for payment processing */
      stripeCustomerId: i.string(),
      /** User's saved filter views */
      savedViews: i.hasMany('savedViews'),
      /** User's alert rules */
      alertRules: i.hasMany('alertRules'),
      /** User's bookmarks */
      bookmarks: i.hasMany('bookmarks'),
    }),

    /**
     * User profiles — public-facing user data.
     * Created on first sign-in, linked to $users.
     */
    profiles: i.entity({
      displayName: i.string(),
      email: i.string(),
      createdAt: i.number(),
      uid: i.string().unique(),
    }),

    /**
     * Saved filter views — named filter presets.
     * Each view captures the full filter state for one-click recall.
     * Linked to a $user via the `owner` relationship.
     */
    savedViews: i.entity({
      name: i.string(),
      filterState: i.json(),
      mapState: i.json(),
      createdAt: i.number(),
      updatedAt: i.number(),
      owner: i.belongsTo('$users'),
    }),

    /**
     * Alert rules — notification triggers based on saved views.
     * When a new event matches the view's filters and meets the severity threshold,
     * a toast notification fires.
     * Linked to a $user via the `owner` relationship.
     */
    alertRules: i.entity({
      name: i.string(),
      severityThreshold: i.number(),
      savedViewId: i.string(),
      active: i.boolean(),
      createdAt: i.number(),
      owner: i.belongsTo('$users'),
    }),

    /**
     * Story bookmarks — individual story saves.
     * Each bookmark links a user to a specific story/article.
     * Linked to a $user via the `owner` relationship.
     */
    bookmarks: i.entity({
      storyId: i.string(),
      storyTitle: i.string(),
      region: i.string(),
      severity: i.number(),
      bookmarkedAt: i.number(),
      owner: i.belongsTo('$users'),
    }),

    /**
     * User subscription records — Stripe integration.
     * Tracks subscription state for gated features.
     */
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
});

export default _schema;
