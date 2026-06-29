/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as authzProbe from "../authzProbe.js";
import type * as callback from "../callback.js";
import type * as http from "../http.js";
import type * as lib_authz from "../lib/authz.js";
import type * as migrations_usersToMemberships from "../migrations/usersToMemberships.js";
import type * as openPlaySessions from "../openPlaySessions.js";
import type * as playerContact from "../playerContact.js";
import type * as players from "../players.js";
import type * as stats from "../stats.js";
import type * as tenants from "../tenants.js";
import type * as tournaments from "../tournaments.js";
import type * as users from "../users.js";
import type * as venues from "../venues.js";
import type * as workosActions from "../workosActions.js";
import type * as workosSync from "../workosSync.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  authzProbe: typeof authzProbe;
  callback: typeof callback;
  http: typeof http;
  "lib/authz": typeof lib_authz;
  "migrations/usersToMemberships": typeof migrations_usersToMemberships;
  openPlaySessions: typeof openPlaySessions;
  playerContact: typeof playerContact;
  players: typeof players;
  stats: typeof stats;
  tenants: typeof tenants;
  tournaments: typeof tournaments;
  users: typeof users;
  venues: typeof venues;
  workosActions: typeof workosActions;
  workosSync: typeof workosSync;
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
