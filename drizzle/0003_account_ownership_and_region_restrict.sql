ALTER TABLE "membership_regions" DROP CONSTRAINT "membership_regions_region_fk";
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "home_organization_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_home_organization_id_organizations_id_fk" FOREIGN KEY ("home_organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_regions" ADD CONSTRAINT "membership_regions_region_fk" FOREIGN KEY ("organization_id","region_id") REFERENCES "public"."regions"("organization_id","id") ON DELETE no action ON UPDATE no action;