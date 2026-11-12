import { meContract, signInContract, signOutContract } from "@/lib/schemas/auth";
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
];
