# Supply Chain Operations ERP

Starter application for a supply chain operations ERP, built with Next.js, TypeScript, and Supabase.

## Local setup

1. Install Node.js 20 or newer.
2. Run `npm install`.
3. Copy `.env.example` to `.env.local`.
4. Fill in the Supabase publishable key from the Supabase dashboard.
5. Run `npm run dev` and open http://localhost:3000.

The Supabase project URL is already configured in `.env.example`. Keep `.env.local` out of Git. Use only the publishable key in browser-accessible configuration; never expose the service-role key.

Database tables and ERP modules should be added after defining the initial workflows and access roles. Enable Row Level Security (RLS) for tables that contain business data.
