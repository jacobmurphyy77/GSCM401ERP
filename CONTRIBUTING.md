# Developer setup and publishing

## Where everything lives

- Public website: https://jacobmurphyy77.github.io/GSCM401ERP/
- Employee workspace: https://jacobmurphyy77.github.io/GSCM401ERP/employee/
- Editable application source: the `main` branch of this repository.
- Accounts, shared records, database operations and payment functions: the existing Supabase project.

Visitors need only the website link. Customer accounts can access their own orders; employee access requires an assigned staff role. GitHub collaborator access is for developers, and Supabase dashboard access is only needed for backend maintenance. Signing in to GitHub or the Supabase dashboard does not create an employee login in the app.

## Run a local copy

Install Node.js 22 LTS and Git, then run:

```sh
git clone https://github.com/jacobmurphyy77/GSCM401ERP.git
cd GSCM401ERP
npm ci
cp .env.example .env.local
```

Open `.env.local` and replace `your_supabase_publishable_key` with this project's public publishable key. A maintainer can find it in Supabase → Project Settings → API Keys or in GitHub → Settings → Secrets and variables → Actions → Variables → `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. The URL and `quick-responder` checkout function are already named in `.env.example`.

```sh
npm run dev
```

Open http://localhost:3000. Local development has no `/GSCM401ERP` prefix; the hosted build adds it automatically. Never commit `.env.local` or use a Supabase service-role/secret key in the frontend.

This configuration connects to the shared demo database. Changes made through your local app affect the shared project. For isolated database work, use a separate Supabase project and its own URL/key. Do not run the foundation seed, reset the database, or reapply all migrations against the existing project just to start developing.

## Make a change

```sh
git switch main
git pull --ff-only
git switch -c feature/describe-your-change
```

Edit source in `app/`, `src/`, or `public/`. Run `npm test`, `npm run lint`, and `npm run typecheck`. Use `npm run build:pages` to verify the hosted export. Commit and push your feature branch, then open a pull request into `main`. GitHub runs these checks and the Pages build for pull requests. A maintainer reviews and merges the change.

The old `gh-pages` branch contains generated files from earlier manual releases. Do not edit those files or use that branch for feature development. The `setup/nextjs-supabase` branch is the historical development branch; start new work from `main`.

## Automatic website updates

`.github/workflows/pages.yml` checks and builds each update to `main`, then publishes the `out/` directory through GitHub Actions. No local server needs to remain running. Check the repository's Actions tab for the green deployment result before announcing an update. Failed checks leave the previous site online.

Maintainer configuration:

1. Under Settings → Pages → Build and deployment, set Source to **GitHub Actions**.
2. Under Settings → Secrets and variables → Actions → Variables, set `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` to the existing project's **public publishable key**. Optionally set `NEXT_PUBLIC_SUPABASE_URL`; the workflow defaults to the current project URL.
3. Under Settings → Environments → github-pages, allow deployments from `main`.
4. In Supabase → Authentication → URL Configuration, use `https://jacobmurphyy77.github.io/GSCM401ERP/` as the Site URL and an allowed redirect. Allow `http://localhost:3000/**` when local authentication redirects are needed.

Browser configuration is embedded when the app is built. After changing a repository variable, rerun the workflow through Actions → Check and publish GitHub Pages → Run workflow on `main`.

To roll back a frontend change, revert the relevant source commit through a reviewed pull request into `main`; the workflow republishes the previous behavior. Frontend deployment does not apply database migrations or deploy Supabase functions. Have a backend maintainer review those separately and preserve existing shared data.

## Backend status and limits

See [the operations release guide](docs/OPERATIONS-RELEASE.md) for existing capabilities and remaining setup. It records purchase-order sending audit migration 007 as pending and automatic confirmation email delivery as unconfigured. The hosting workflow does not apply that migration or enable email. Stripe checkout is a sandbox demo, not live payment processing.

GitHub Pages and Supabase both offer free plans with usage quotas and service policies. Supabase free projects may pause after inactivity; authentication emails also have rate limits. Public visitors do not need hosting accounts, but free hosting does not mean unlimited traffic, storage, accounts, or guaranteed uptime. Monitor the providers' usage dashboards before a class demonstration. GitHub Pages is appropriate here for the course demo, not a production ecommerce service; review its usage policy before real commercial use.

The initial merge review found dependency audit warnings in build/lint tooling (including PostCSS and glob matching libraries). This is a static export; no Next.js server is exposed by Pages. Dependency upgrades remain maintenance work and should be tested separately rather than applying `npm audit fix --force` during onboarding.
