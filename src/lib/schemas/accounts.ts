import { z } from "zod";

import type { EndpointContract } from "@/lib/openapi/contract";

import { pageSchema, paginationQuerySchema } from "./pagination";
import { humanRoleSchema } from "./permissions";

export const accountStatusSchema = z.enum(["invited", "active", "deactivated"]).meta({
  id: "AccountStatus",
  description:
    "`invited` has no password yet, `active` can sign in, `deactivated` cannot and has no sessions.",
});

/** A person's name, as an Admin invites it and as the person changes it: trimmed, 1 to 100. */
export const accountNameSchema = z.string().trim().min(1).max(100);

/** An account as an Admin sees it in the people list. Never includes credentials. */
export const managedAccountSchema = z
  .strictObject({
    id: z.uuid(),
    name: z.string(),
    email: z.string(),
    role: humanRoleSchema,
    status: accountStatusSchema,
    createdAt: z.iso.datetime(),
    lastSeenAt: z.iso.datetime().nullable(),
  })
  .meta({ id: "ManagedAccount" });

export type ManagedAccount = z.infer<typeof managedAccountSchema>;

export const accountPageSchema = pageSchema(managedAccountSchema).meta({ id: "AccountPage" });

export type AccountPage = z.infer<typeof accountPageSchema>;

export const inviteRequestSchema = z
  .strictObject({
    name: accountNameSchema,
    email: z.email(),
    role: humanRoleSchema,
  })
  .meta({ id: "InviteAccountRequest" });

export type InviteRequest = z.infer<typeof inviteRequestSchema>;

export const updateAccountRequestSchema = z
  .strictObject({
    role: humanRoleSchema.optional(),
    active: z
      .boolean()
      .optional()
      .meta({ description: "`false` deactivates the account, `true` reactivates it." }),
  })
  .refine((value) => value.role !== undefined || value.active !== undefined, {
    error: "Send at least one of role and active.",
  })
  .meta({ id: "UpdateAccountRequest" });

export type UpdateAccountRequest = z.infer<typeof updateAccountRequestSchema>;

/** A one-time link. Shown exactly once, when it is issued; only its hash is stored. */
export const accountLinkSchema = z
  .strictObject({
    url: z.url(),
    expiresAt: z.iso.datetime(),
  })
  .meta({ id: "AccountLink" });

export type AccountLink = z.infer<typeof accountLinkSchema>;

export const inviteResponseSchema = z
  .strictObject({ account: managedAccountSchema, link: accountLinkSchema })
  .meta({ id: "InviteAccountResponse" });

export const resetLinkResponseSchema = z
  .strictObject({ link: accountLinkSchema })
  .meta({ id: "ResetLinkResponse" });

export const accountIdParamsSchema = z.strictObject({ accountId: z.uuid() });

const NEEDS_MANAGE = "Needs the `accounts:manage` permission (Admin).";

export const listAccountsContract = {
  method: "get",
  path: "/api/v1/accounts",
  summary: "List accounts",
  description: `Lists human accounts, oldest first, with keyset pagination. ${NEEDS_MANAGE}`,
  public: false,
  request: { query: paginationQuerySchema },
  responses: {
    200: { description: "A page of accounts.", schema: accountPageSchema },
    400: { description: "The query string is not valid.", problem: true },
  },
} satisfies EndpointContract;

export const inviteAccountContract = {
  method: "post",
  path: "/api/v1/accounts",
  summary: "Invite a person",
  description:
    "Creates an account with no password and a one-time link, valid for 7 days, that is shown " +
    `only in this response. ${NEEDS_MANAGE} Must come from the app's own origin.`,
  public: false,
  request: { body: inviteRequestSchema },
  responses: {
    201: { description: "The account and its link.", schema: inviteResponseSchema },
    400: { description: "The body is not valid.", problem: true },
    409: { description: "An account with this email already exists.", problem: true },
    415: { description: "The body is not JSON.", problem: true },
  },
} satisfies EndpointContract;

export const updateAccountContract = {
  method: "patch",
  path: "/api/v1/accounts/{accountId}",
  summary: "Change an account's role or activity",
  description:
    "Changes the role and/or deactivates or reactivates a human account. A role change or a " +
    "deactivation ends the account's sessions at once. The only active Admin cannot be " +
    `demoted or deactivated. ${NEEDS_MANAGE} Must come from the app's own origin.`,
  public: false,
  request: { params: accountIdParamsSchema, body: updateAccountRequestSchema },
  responses: {
    200: { description: "The account after the change.", schema: managedAccountSchema },
    400: { description: "The path or the body is not valid.", problem: true },
    404: { description: "There is no such human account.", problem: true },
    409: {
      description: "The change would leave no active Admin (code `last_admin`).",
      problem: true,
    },
    415: { description: "The body is not JSON.", problem: true },
  },
} satisfies EndpointContract;

export const resetLinkContract = {
  method: "post",
  path: "/api/v1/accounts/{accountId}/reset-link",
  summary: "Issue a one-time link for an account",
  description:
    "For an invited account it issues a fresh invitation link, for an active one a password " +
    "reset link. Earlier unused links of the account stop working. The link is shown only in " +
    `this response. ${NEEDS_MANAGE} Must come from the app's own origin.`,
  public: false,
  request: { params: accountIdParamsSchema },
  responses: {
    201: { description: "The link.", schema: resetLinkResponseSchema },
    400: { description: "The path is not valid.", problem: true },
    404: { description: "There is no such human account.", problem: true },
    409: { description: "The account is deactivated.", problem: true },
  },
} satisfies EndpointContract;

export const revokeInvitationContract = {
  method: "delete",
  path: "/api/v1/accounts/{accountId}/invitation",
  summary: "Revoke an invitation that was never accepted",
  description:
    "Removes an invited account that never set a password, with its links, so its email can " +
    "be invited again. An account that has a password is refused with 409: deactivate it " +
    `instead. ${NEEDS_MANAGE} Must come from the app's own origin.`,
  public: false,
  request: { params: accountIdParamsSchema },
  responses: {
    204: { description: "The invitation was revoked.", noContent: true },
    400: { description: "The path is not valid.", problem: true },
    404: { description: "There is no such human account.", problem: true },
    409: { description: "The invitation was already accepted.", problem: true },
  },
} satisfies EndpointContract;
