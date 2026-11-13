import { z } from "zod";

import type { EndpointContract } from "@/lib/openapi/contract";

import { accountNameSchema } from "./accounts";
import { permissionSchema } from "./permissions";

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

// Length only, no composition rules (WT-02 decision 7). Messages are written by hand and
// never interpolate the value: a rejected password must not travel anywhere.
export const passwordSchema = z
  .string({ error: "Must be text" })
  .min(PASSWORD_MIN_LENGTH, { error: `Must be at least ${String(PASSWORD_MIN_LENGTH)} characters` })
  .max(PASSWORD_MAX_LENGTH, { error: `Must be at most ${String(PASSWORD_MAX_LENGTH)} characters` });

/** Body of `POST /api/v1/auth/sign-in`. The 12 character minimum is not applied here. */
export const signInRequestSchema = z
  .strictObject({
    email: z.email(),
    password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
  })
  .meta({ id: "SignInRequest" });

/** Body of `POST /api/v1/setup`: the first Admin. The password follows the same rule as any. */
export const setupRequestSchema = z
  .strictObject({
    name: accountNameSchema,
    email: z.email(),
    password: passwordSchema,
  })
  .meta({ id: "SetupRequest" });

/** Body of `POST /api/v1/account-links/accept`: a one-time token and the password to set. */
export const acceptLinkRequestSchema = z
  .strictObject({
    token: z.string().regex(/^[A-Za-z0-9_-]{43,128}$/, { error: "Not a valid link token." }),
    password: passwordSchema,
  })
  .meta({ id: "AcceptLinkRequest" });

/** An account as the API shows it. Never includes credentials. */
export const accountSummarySchema = z
  .strictObject({
    id: z.uuid(),
    kind: z.enum(["human", "agent"]),
    name: z.string(),
    email: z.string().nullable(),
    role: z.string(),
  })
  .meta({ id: "AccountSummary" });

export type AccountSummary = z.infer<typeof accountSummarySchema>;

/** Body of `GET /api/v1/me`: the caller's account and what its role allows. */
export const meResponseSchema = z
  .strictObject({
    ...accountSummarySchema.shape,
    permissions: z.array(permissionSchema),
  })
  .meta({ id: "Me" });

export type MeResponse = z.infer<typeof meResponseSchema>;

export const signInContract = {
  method: "post",
  path: "/api/v1/auth/sign-in",
  summary: "Sign in",
  description:
    "Signs a person in with email and password and sets the session cookie. Public: it cannot " +
    "require credentials. A wrong password, an unknown email and a deactivated account are " +
    "answered identically. Must come from the app's own origin.",
  access: { kind: "public" },
  request: { body: signInRequestSchema },
  responses: {
    200: { description: "Signed in. The session cookie is set.", schema: accountSummarySchema },
    400: { description: "The body is not valid.", problem: true },
    401: { description: "Invalid email or password.", problem: true },
    403: { description: "The request does not come from the app's own origin.", problem: true },
    415: { description: "The body is not JSON.", problem: true },
    429: { description: "Too many attempts. See Retry-After.", problem: true },
  },
} satisfies EndpointContract;

export const signOutContract = {
  method: "post",
  path: "/api/v1/auth/sign-out",
  summary: "Sign out",
  description: "Ends the current session and clears its cookie. Needs a session, no permission.",
  access: { kind: "authenticated" },
  responses: { 204: { description: "Signed out.", noContent: true } },
} satisfies EndpointContract;

/** Body of `PATCH /api/v1/me`: the caller's new name. */
export const updateMeRequestSchema = z
  .strictObject({ name: accountNameSchema })
  .meta({ id: "UpdateMeRequest" });

/**
 * Body of `POST /api/v1/me/password`. The current password is checked, not validated
 * against today's rule, as at sign-in; the new one follows the rule of WT-02 decision 7.
 */
export const changePasswordRequestSchema = z
  .strictObject({
    currentPassword: z
      .string({ error: "Must be text" })
      .min(1, { error: "Required" })
      .max(PASSWORD_MAX_LENGTH, {
        error: `Must be at most ${String(PASSWORD_MAX_LENGTH)} characters`,
      }),
    newPassword: passwordSchema,
  })
  .meta({ id: "ChangePasswordRequest" });

export const meContract = {
  method: "get",
  path: "/api/v1/me",
  summary: "The signed-in account",
  description: "Returns the caller's account and permissions. Needs a session, no permission.",
  access: { kind: "authenticated" },
  responses: { 200: { description: "The caller.", schema: meResponseSchema } },
} satisfies EndpointContract;

export const setupContract = {
  method: "post",
  path: "/api/v1/setup",
  summary: "Create the first Admin",
  description:
    "First-run setup. Creates the first Admin and signs them in. Public, because before the " +
    "first account exists there is nobody to authenticate. Once any account exists it answers " +
    "404, like an unknown path. Must come from the app's own origin.",
  access: { kind: "public" },
  request: { body: setupRequestSchema },
  responses: {
    201: {
      description: "The Admin was created. The session cookie is set.",
      schema: accountSummarySchema,
    },
    400: { description: "The body is not valid.", problem: true },
    403: { description: "The request does not come from the app's own origin.", problem: true },
    404: { description: "The installation is already set up.", problem: true },
    415: { description: "The body is not JSON.", problem: true },
  },
} satisfies EndpointContract;

export const acceptLinkContract = {
  method: "post",
  path: "/api/v1/account-links/accept",
  summary: "Accept an invitation or reset link",
  description:
    "Sets the password of the account a one-time link was issued for, and signs the person in. " +
    "Public: the token is the credential. Every refusal (unknown, used, expired, replaced, or " +
    "the account is deactivated) is the same 404 `invalid_link`. All earlier sessions of the " +
    "account end. Must come from the app's own origin.",
  access: { kind: "public" },
  request: { body: acceptLinkRequestSchema },
  responses: {
    200: {
      description: "The password was set. The session cookie is set.",
      schema: accountSummarySchema,
    },
    400: { description: "The body is not valid.", problem: true },
    403: { description: "The request does not come from the app's own origin.", problem: true },
    404: { description: "The link is not valid (code `invalid_link`).", problem: true },
    415: { description: "The body is not JSON.", problem: true },
    429: { description: "Too many attempts from this address. See Retry-After.", problem: true },
  },
} satisfies EndpointContract;

export const updateMeContract = {
  method: "patch",
  path: "/api/v1/me",
  summary: "Change one's own name",
  description:
    "Changes the caller's name and returns the caller as `GET /api/v1/me` does. Needs a " +
    "session, no permission. Must come from the app's own origin.",
  access: { kind: "authenticated" },
  request: { body: updateMeRequestSchema },
  responses: {
    200: { description: "The name was changed.", schema: meResponseSchema },
    400: { description: "The body is not valid.", problem: true },
    403: { description: "The request does not come from the app's own origin.", problem: true },
    415: { description: "The body is not JSON.", problem: true },
  },
} satisfies EndpointContract;

export const changePasswordContract = {
  method: "post",
  path: "/api/v1/me/password",
  summary: "Change one's own password",
  description:
    "Replaces the caller's password after checking the current one, and ends every other " +
    "session of the account; the session that made the request stays signed in. A wrong " +
    "current password is a 400 with a field error on `currentPassword`. Limited per account. " +
    "Needs a session, no permission. Must come from the app's own origin.",
  access: { kind: "authenticated" },
  request: { body: changePasswordRequestSchema },
  responses: {
    204: { description: "The password was changed.", noContent: true },
    400: {
      description: "The body is not valid, or the current password is wrong.",
      problem: true,
    },
    403: { description: "The request does not come from the app's own origin.", problem: true },
    415: { description: "The body is not JSON.", problem: true },
    429: { description: "Too many attempts for this account. See Retry-After.", problem: true },
  },
} satisfies EndpointContract;
