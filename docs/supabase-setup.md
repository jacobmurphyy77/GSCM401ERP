# Connect the Supabase project

The starter is configured for project `skfmrqrsmnsmoniyuzdq`:

```text
https://skfmrqrsmnsmoniyuzdq.supabase.co
```

## Local application

1. In the Supabase dashboard, open **Project Settings → API Keys**.
2. Copy the project's **publishable key**. It is safe for browser use when database tables enforce Row Level Security (RLS).
3. In the repository root, copy `.env.example` to `.env.local`.
4. Replace `your_supabase_publishable_key` with the publishable key.
5. Run `npm install`, then `npm run dev`.

The browser and server client factories are in `src/lib/supabase/`. Import the browser client from client components and the server client from server components, route handlers, or server actions.

Never put a secret key or service-role key in a `NEXT_PUBLIC_*` variable, source code, or GitHub. Keep local values in the ignored `.env.local` file. For deployment, add the URL and publishable key as environment variables in the hosting provider's project settings.

## Database changes

Define ERP workflows, roles, and data ownership before adding tables. Apply RLS policies to each business table before exposing it to the application. Keep schema changes in reviewed Supabase migrations; do not use a service-role key in the app.

The project reference for Supabase CLI linking is `skfmrqrsmnsmoniyuzdq`. CLI authentication and database linking are separate local steps and should be done by a project maintainer.
