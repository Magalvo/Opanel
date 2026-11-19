import { Bot } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { AccountRef } from "@/lib/schemas/account-ref";

/**
 * An account's name as a task or a comment shows it: an agent's is followed by an "Agent"
 * badge, a person's stands alone (WS-074). The word is visible text, so it is read aloud.
 */
export function AccountName({ account }: Readonly<{ account: Pick<AccountRef, "name" | "kind"> }>) {
  return (
    <span className="inline-flex min-w-0 flex-wrap items-center gap-1.5">
      <span className="break-words">{account.name}</span>
      {account.kind === "agent" && (
        <Badge variant="secondary">
          <Bot aria-hidden="true" />
          Agent
        </Badge>
      )}
    </span>
  );
}
