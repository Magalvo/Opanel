"use client";

import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { AccountLink } from "@/lib/schemas/accounts";

export interface ShownLink {
  title: string;
  link: AccountLink;
}

/**
 * Shows a one-time link exactly once (WS-020). It lives only in the state of whoever opened
 * this dialog and is gone when the dialog closes: the server keeps only its hash.
 */
export function LinkDialog({
  shown,
  onClose,
}: Readonly<{ shown: ShownLink | null; onClose: () => void }>) {
  const [copyMessage, setCopyMessage] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);

  async function copy() {
    if (!shown) return;
    try {
      await navigator.clipboard.writeText(shown.link.url);
      setCopyMessage("Link copied.");
    } catch {
      field.current?.select();
      setCopyMessage("Could not copy automatically. Select the link and copy it.");
    }
  }

  return (
    <Dialog
      open={shown !== null}
      onOpenChange={(open) => {
        if (!open) {
          setCopyMessage(null);
          onClose();
        }
      }}
    >
      {shown !== null && (
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{shown.title}</DialogTitle>
            <DialogDescription>Send this link to the person.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <label htmlFor="link-field" className="text-sm font-medium">
              Link
            </label>
            <Input
              id="link-field"
              ref={field}
              readOnly
              value={shown.link.url}
              onFocus={(e) => {
                e.target.select();
              }}
            />
            <p className="text-xs font-medium">This link is shown only now. It works once.</p>
            <p className="text-xs text-muted-foreground">
              Expires {new Date(shown.link.expiresAt).toLocaleString()}.
            </p>
            <p role="status" className="min-h-4 text-xs text-muted-foreground">
              {copyMessage}
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => void copy()}>
              Copy link
            </Button>
            <Button onClick={onClose}>Done</Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  );
}
