ALTER TABLE "task_events" DROP CONSTRAINT "task_events_type_check";--> statement-breakpoint
ALTER TABLE "task_links" DROP CONSTRAINT "task_links_type_check";--> statement-breakpoint
ALTER TABLE "task_events" ADD CONSTRAINT "task_events_type_check" CHECK ("task_events"."type" in ('created', 'field_changed', 'moved', 'deleted', 'restored', 'commented', 'reported_again', 'linked', 'unlinked'));--> statement-breakpoint
ALTER TABLE "task_links" ADD CONSTRAINT "task_links_relates_to_order_check" CHECK ("task_links"."type" <> 'relates_to' or "task_links"."from_task_id" < "task_links"."to_task_id");--> statement-breakpoint
ALTER TABLE "task_links" ADD CONSTRAINT "task_links_type_check" CHECK ("task_links"."type" in ('blocks', 'duplicates', 'regression_of', 'relates_to'));