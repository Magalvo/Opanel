CREATE TABLE "agent_projects" (
	"account_id" uuid NOT NULL,
	"account_kind" text DEFAULT 'agent' NOT NULL,
	"project_id" uuid NOT NULL,
	CONSTRAINT "agent_projects_account_id_project_id_pk" PRIMARY KEY("account_id","project_id"),
	CONSTRAINT "agent_projects_account_kind_check" CHECK ("agent_projects"."account_kind" = 'agent')
);
--> statement-breakpoint
CREATE TABLE "agent_scopes" (
	"account_id" uuid NOT NULL,
	"account_kind" text DEFAULT 'agent' NOT NULL,
	"scope" text NOT NULL,
	CONSTRAINT "agent_scopes_account_id_scope_pk" PRIMARY KEY("account_id","scope"),
	CONSTRAINT "agent_scopes_account_kind_check" CHECK ("agent_scopes"."account_kind" = 'agent'),
	CONSTRAINT "agent_scopes_scope_check" CHECK ("agent_scopes"."scope" in ('projects:read', 'tasks:read', 'reports:write', 'comments:write', 'tasks:write'))
);
--> statement-breakpoint
CREATE TABLE "api_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"account_kind" text DEFAULT 'agent' NOT NULL,
	"public_id" text NOT NULL,
	"secret_hash" text NOT NULL,
	"name" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	CONSTRAINT "api_tokens_public_id_unique" UNIQUE("public_id"),
	CONSTRAINT "api_tokens_account_kind_check" CHECK ("api_tokens"."account_kind" = 'agent'),
	CONSTRAINT "api_tokens_public_id_check" CHECK ("api_tokens"."public_id" ~ '^[a-z2-7]{12}$'),
	CONSTRAINT "api_tokens_secret_hash_check" CHECK ("api_tokens"."secret_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "api_tokens_name_check" CHECK (char_length("api_tokens"."name") between 1 and 80)
);
--> statement-breakpoint
-- Before the composite foreign keys below, which reference it (WS-071 question 1).
CREATE UNIQUE INDEX "accounts_id_kind_idx" ON "accounts" USING btree ("id","kind");--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "all_projects" boolean;--> statement-breakpoint
ALTER TABLE "agent_projects" ADD CONSTRAINT "agent_projects_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_projects" ADD CONSTRAINT "agent_projects_account_fk" FOREIGN KEY ("account_id","account_kind") REFERENCES "public"."accounts"("id","kind") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_scopes" ADD CONSTRAINT "agent_scopes_account_fk" FOREIGN KEY ("account_id","account_kind") REFERENCES "public"."accounts"("id","kind") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_account_fk" FOREIGN KEY ("account_id","account_kind") REFERENCES "public"."accounts"("id","kind") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_projects_project_id_idx" ON "agent_projects" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "api_tokens_account_id_idx" ON "api_tokens" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_agent_name_lower_idx" ON "accounts" USING btree (lower("name")) WHERE "accounts"."kind" = 'agent';--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_agent_role_check" CHECK ("accounts"."kind" <> 'agent' or "accounts"."role" in ('qa_agent', 'worker_agent'));--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_agent_no_email_check" CHECK ("accounts"."kind" <> 'agent' or "accounts"."email" is null);--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_agent_fields_check" CHECK (("accounts"."kind" = 'human' and "accounts"."description" is null and "accounts"."all_projects" is null)
        or ("accounts"."kind" = 'agent' and "accounts"."all_projects" is not null));--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_description_length_check" CHECK ("accounts"."description" is null or char_length("accounts"."description") between 1 and 500);