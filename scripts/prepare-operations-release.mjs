import { readFile, mkdir, writeFile } from "node:fs/promises";
const root = new URL("../", import.meta.url);
const files = ["202611170004_bike_specific_components.sql", "202611170005_operations_workflows.sql", "202611170006_model_part_pricing.sql", "202611170007_purchase_order_dispatch.sql"];
const sections = await Promise.all(files.map(async (file) => `-- Source: supabase/migrations/${file}\n${await readFile(new URL(`supabase/migrations/${file}`, root), "utf8")}`));
await mkdir(new URL("supabase/rollout/", root), { recursive: true });
await writeFile(new URL("supabase/rollout/20261117_operations_upgrade.sql", root), "-- Wasatch Cycle Works operations upgrade.\n-- Requires the existing foundation, retail parts, and Stripe demo migrations 001-003.\n-- No database reset. Included migrations are safe to rerun.\n\n" + sections.join("\n\n"));
await writeFile(new URL("supabase/dashboard-deploy/manage-employees.ts", root), await readFile(new URL("supabase/functions/manage-employees/index.ts", root), "utf8"));
console.log("Prepared one SQL upgrade and the standalone manager function.");
