CREATE TABLE "verification" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "credentials" ADD COLUMN "access_token" text;--> statement-breakpoint
ALTER TABLE "credentials" ADD COLUMN "refresh_token" text;--> statement-breakpoint
ALTER TABLE "credentials" ADD COLUMN "id_token" text;--> statement-breakpoint
ALTER TABLE "credentials" ADD COLUMN "access_token_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "credentials" ADD COLUMN "refresh_token_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "credentials" ADD COLUMN "scope" text;--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");