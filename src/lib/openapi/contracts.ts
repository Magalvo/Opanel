import {
  inviteAccountContract,
  listAccountsContract,
  resetLinkContract,
  revokeInvitationContract,
  updateAccountContract,
} from "@/lib/schemas/accounts";
import {
  createAgentContract,
  createApiTokenContract,
  getAgentContract,
  listAgentsContract,
  listApiTokensContract,
  revokeApiTokenContract,
  updateAgentContract,
} from "@/lib/schemas/agents";
import {
  acceptLinkContract,
  changePasswordContract,
  meContract,
  setupContract,
  signInContract,
  signOutContract,
  updateMeContract,
} from "@/lib/schemas/auth";
import { submitBugReportContract } from "@/lib/schemas/bug-reports";
import {
  createColumnContract,
  deleteColumnContract,
  listColumnsContract,
  moveColumnContract,
  updateColumnContract,
} from "@/lib/schemas/columns";
import { createCommentContract, listCommentsContract } from "@/lib/schemas/comments";
import {
  createEpicContract,
  getEpicContract,
  listEpicsContract,
  updateEpicContract,
} from "@/lib/schemas/epics";
import { projectEventsContract } from "@/lib/schemas/events";
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
import { listBugReportsContract } from "@/lib/schemas/task-bug-reports";
import {
  createTaskContract,
  deleteTaskContract,
  getTaskContract,
  listTasksContract,
  moveTaskContract,
  restoreTaskContract,
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
import { getTriageContract, updateTriageContract } from "@/lib/schemas/triage";

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
  getTriageContract,
  updateTriageContract,
  submitBugReportContract,
  listBugReportsContract,
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
  deleteTaskContract,
  restoreTaskContract,
  listEpicsContract,
  createEpicContract,
  getEpicContract,
  updateEpicContract,
  listCommentsContract,
  createCommentContract,
  projectEventsContract,
  listAgentsContract,
  createAgentContract,
  getAgentContract,
  updateAgentContract,
  listApiTokensContract,
  createApiTokenContract,
  revokeApiTokenContract,
];
