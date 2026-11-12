import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { fetchConnectivityCatalogue } from "../server/allenApi.ts";

const results = await fetchConnectivityCatalogue();
const output = fileURLToPath(new URL("../../registration/resources/connectivity_experiments.json", import.meta.url));
writeFileSync(output, JSON.stringify({ updatedAt: new Date().toISOString(), results }) + "\n", "utf8");
console.log(`Saved ${results.length} public Allen injection sites.`);
