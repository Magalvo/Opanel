import {
  inviteAccountContract,
  listAccountsContract,
  resetLinkContract,
  revokeInvitationContract,
  updateAccountContract,
} from "@/lib/schemas/accounts";
import {
  acceptLinkContract,
  changePasswordContract,
  meContract,
  setupContract,
  signInContract,
  signOutContract,
  updateMeContract,
} from "@/lib/schemas/auth";
import { healthContract } from "@/lib/schemas/health";
import { openApiContract } from "@/lib/schemas/openapi";

import type { EndpointContract } from "./contract";

/** Every operation of the API. Add a contract here when adding a route handler. */
export const contracts: readonly EndpointContract[] = [
  healthContract,
  openApiContract,
  signInContract,
  signOutContract,
  meContract,
  updateMeContract,
  changePasswordContract,
  setupContract,
  acceptLinkContract,
  listAccountsContract,
  inviteAccountContract,
  updateAccountContract,
  resetLinkContract,
  revokeInvitationContract,
];
