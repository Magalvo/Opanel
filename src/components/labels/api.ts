import { call, callNoContent, jsonBody } from "@/lib/api-client";
import {
  type LabelColour,
  labelListSchema,
  labelSchema,
  type UpdateLabelRequest,
} from "@/lib/schemas/labels";

// The labels API (WS-107) as the web app calls it (WS-108 section 6).

export const COLOUR_NAMES: Record<LabelColour, string> = {
  gray: "Gray",
  red: "Red",
  orange: "Orange",
  amber: "Amber",
  green: "Green",
  teal: "Teal",
  blue: "Blue",
  indigo: "Indigo",
  purple: "Purple",
  pink: "Pink",
};

export function listLabels(projectKey: string) {
  return call(`/api/v1/projects/${projectKey}/labels`, {}, labelListSchema);
}

export function createLabel(projectKey: string, body: { name: string; colour: LabelColour }) {
  return call(
    `/api/v1/projects/${projectKey}/labels`,
    { method: "POST", ...jsonBody(body) },
    labelSchema,
  );
}

export function updateLabel(labelId: string, body: UpdateLabelRequest) {
  return call(`/api/v1/labels/${labelId}`, { method: "PATCH", ...jsonBody(body) }, labelSchema);
}

export function deleteLabel(labelId: string) {
  return callNoContent(`/api/v1/labels/${labelId}`, { method: "DELETE" });
}
