/**
 * Any other page of the project (its settings, its board) closes the task dialog: without it,
 * the slot would keep showing the dialog after a soft navigation.
 */
export default function CatchAll() {
  return null;
}
