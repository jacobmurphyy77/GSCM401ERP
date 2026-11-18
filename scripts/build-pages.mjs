import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const repository = process.env.GITHUB_REPOSITORY || "jacobmurphyy77/GSCM401ERP";
const repositoryName = repository.split("/").at(-1);
const basePath = repositoryName?.endsWith(".github.io") ? "" : `/${repositoryName}`;

execFileSync(process.execPath, ["node_modules/next/dist/bin/next", "build"], {
  env: {
    ...process.env,
    NEXT_PUBLIC_BASE_PATH: basePath,
    // This project's checkout handler was deployed through the dashboard with this slug.
    NEXT_PUBLIC_CHECKOUT_FUNCTION: process.env.NEXT_PUBLIC_CHECKOUT_FUNCTION || "quick-responder",
  },
  stdio: "inherit",
});

// Keep GitHub Pages from dropping Next.js's _next assets during publication.
writeFileSync("out/.nojekyll", "");
