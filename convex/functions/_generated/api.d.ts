/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as admin from "../admin.js";
import type * as alerts from "../alerts.js";
import type * as articles from "../articles.js";
import type * as auth from "../auth.js";
import type * as billing from "../billing.js";
import type * as bookmarks from "../bookmarks.js";
import type * as briefs from "../briefs.js";
import type * as cases from "../cases.js";
import type * as crons from "../crons.js";
import type * as digests from "../digests.js";
import type * as entities from "../entities.js";
import type * as events from "../events.js";
import type * as exports from "../exports.js";
import type * as http from "../http.js";
import type * as ingest from "../ingest.js";
import type * as intel from "../intel.js";
import type * as lib_access from "../lib/access.js";
import type * as lib_embed from "../lib/embed.js";
import type * as lib_entitlements from "../lib/entitlements.js";
import type * as lib_intent from "../lib/intent.js";
import type * as lib_qa from "../lib/qa.js";
import type * as lib_recency from "../lib/recency.js";
import type * as lib_regions from "../lib/regions.js";
import type * as lib_sourceConfidence from "../lib/sourceConfidence.js";
import type * as ops from "../ops.js";
import type * as qa from "../qa.js";
import type * as rag from "../rag.js";
import type * as regions from "../regions.js";
import type * as savedViews from "../savedViews.js";
import type * as sourceRequests from "../sourceRequests.js";
import type * as sourceSync from "../sourceSync.js";
import type * as stripeEvents from "../stripeEvents.js";
import type * as trends from "../trends.js";
import type * as users from "../users.js";
import type * as watchBaselines from "../watchBaselines.js";
import type * as watchlist from "../watchlist.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  admin: typeof admin;
  alerts: typeof alerts;
  articles: typeof articles;
  auth: typeof auth;
  billing: typeof billing;
  bookmarks: typeof bookmarks;
  briefs: typeof briefs;
  cases: typeof cases;
  crons: typeof crons;
  digests: typeof digests;
  entities: typeof entities;
  events: typeof events;
  exports: typeof exports;
  http: typeof http;
  ingest: typeof ingest;
  intel: typeof intel;
  "lib/access": typeof lib_access;
  "lib/embed": typeof lib_embed;
  "lib/entitlements": typeof lib_entitlements;
  "lib/intent": typeof lib_intent;
  "lib/qa": typeof lib_qa;
  "lib/recency": typeof lib_recency;
  "lib/regions": typeof lib_regions;
  "lib/sourceConfidence": typeof lib_sourceConfidence;
  ops: typeof ops;
  qa: typeof qa;
  rag: typeof rag;
  regions: typeof regions;
  savedViews: typeof savedViews;
  sourceRequests: typeof sourceRequests;
  sourceSync: typeof sourceSync;
  stripeEvents: typeof stripeEvents;
  trends: typeof trends;
  users: typeof users;
  watchBaselines: typeof watchBaselines;
  watchlist: typeof watchlist;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
