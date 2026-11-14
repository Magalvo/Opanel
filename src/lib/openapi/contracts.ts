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
import {
  createColumnContract,
  deleteColumnContract,
  listColumnsContract,
  moveColumnContract,
  updateColumnContract,
} from "@/lib/schemas/columns";
import { healthContract } from "@/lib/schemas/health";
import { openApiContract } from "@/lib/schemas/openapi";
import { listPeopleContract } from "@/lib/schemas/people";
import {
  archiveProjectContract,
  createProjectContract,
  getProjectContract,
  listProjectsContract,
  unarchiveProjectContract,
  updateProjectContract,
} from "@/lib/schemas/projects";
import {
  createTaskContract,
  getTaskContract,
  listTasksContract,
  moveTaskContract,
  updateTaskContract,
} from "@/lib/schemas/tasks";
import {
  addTeamMemberContract,
  createTeamContract,
  deleteTeamContract,
  getTeamContract,
  listTeamsContract,
  removeTeamMemberContract,
  updateTeamContract,
} from "@/lib/schemas/teams";

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
  listPeopleContract,
  listTeamsContract,
  createTeamContract,
  getTeamContract,
  updateTeamContract,
  deleteTeamContract,
  addTeamMemberContract,
  removeTeamMemberContract,
  listProjectsContract,
  createProjectContract,
  getProjectContract,
  updateProjectContract,
  archiveProjectContract,
  unarchiveProjectContract,
  listColumnsContract,
  createColumnContract,
  updateColumnContract,
  moveColumnContract,
  deleteColumnContract,
  listTasksContract,
  createTaskContract,
  getTaskContract,
  updateTaskContract,
  moveTaskContract,
];
