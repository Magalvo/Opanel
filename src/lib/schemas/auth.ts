import { z } from "zod";

import type { EndpointContract } from "@/lib/openapi/contract";

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
    name: z.string().trim().min(1).max(100),
    email: z.email(),
    password: passwordSchema,
  })
  .meta({ id: "SetupRequest" });

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
  public: true,
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
  public: false,
  responses: { 204: { description: "Signed out.", noContent: true } },
} satisfies EndpointContract;

export const meContract = {
  method: "get",
  path: "/api/v1/me",
  summary: "The signed-in account",
  description: "Returns the caller's account and permissions. Needs a session, no permission.",
  public: false,
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
  public: true,
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
