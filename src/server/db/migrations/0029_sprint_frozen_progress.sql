ALTER TABLE "sprints" DROP CONSTRAINT "sprints_completed_check";--> statement-breakpoint
ALTER TABLE "sprints" ADD COLUMN "total_tasks" integer;--> statement-breakpoint
ALTER TABLE "sprints" ADD COLUMN "completed_tasks" integer;--> statement-breakpoint
ALTER TABLE "sprints" ADD COLUMN "unestimated" integer;--> statement-breakpoint
ALTER TABLE "sprints" ADD CONSTRAINT "sprints_completed_check" CHECK (case when "sprints"."state" = 'completed'
        then "sprints"."completed_at" is not null and "sprints"."total_points" is not null and "sprints"."completed_points" is not null
          and "sprints"."total_tasks" is not null and "sprints"."completed_tasks" is not null and "sprints"."unestimated" is not null
        else "sprints"."completed_at" is null and "sprints"."total_points" is null and "sprints"."completed_points" is null
          and "sprints"."total_tasks" is null and "sprints"."completed_tasks" is null and "sprints"."unestimated" is null end);