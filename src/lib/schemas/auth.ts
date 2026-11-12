import { z } from "zod";

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

// Length only, no composition rules (WT-02 decision 7). Messages are written by hand and
// never interpolate the value: a rejected password must not travel anywhere.
export const passwordSchema = z
  .string({ error: "Must be text" })
  .min(PASSWORD_MIN_LENGTH, { error: `Must be at least ${String(PASSWORD_MIN_LENGTH)} characters` })
  .max(PASSWORD_MAX_LENGTH, { error: `Must be at most ${String(PASSWORD_MAX_LENGTH)} characters` });
