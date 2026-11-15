import type { ReactNode } from "react";

/** The project's pages, with the task dialog (the `@modal` slot) over them (WS-038). */
export default function ProjectLayout({
  children,
  modal,
}: Readonly<{ children: ReactNode; modal: ReactNode }>) {
  return (
    <>
      {children}
      {modal}
    </>
  );
}
