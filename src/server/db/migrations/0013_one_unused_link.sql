-- Only the newest link works (WT-02 decisions 5 and 6, WS-059): keep the newest unused link of each account, ties broken by id; used links stay.
DELETE FROM "account_tokens" t
WHERE t."used_at" IS NULL
  AND EXISTS (
    SELECT 1 FROM "account_tokens" n
    WHERE n."account_id" = t."account_id" AND n."used_at" IS NULL
      AND (n."created_at", n."id") > (t."created_at", t."id")
  );--> statement-breakpoint
CREATE UNIQUE INDEX "account_tokens_one_unused_per_account" ON "account_tokens" USING btree ("account_id") WHERE "account_tokens"."used_at" is null;
