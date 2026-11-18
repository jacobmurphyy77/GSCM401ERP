# Wasatch ERP Database private connection

This prepared private plugin package targets Supabase's official hosted MCP server, scoped to the existing ERP project and database/Edge Function/documentation tool groups. It hosts no new server and contains no secrets. The host would handle OAuth with Supabase through dynamic client registration.

**Status:** Registration was rejected on November 17, 2026: "You do not have permission to use plugins with MCPs. Contact your workspace admin for access." No plugin was registered or connected, and no live Supabase administration was performed. This package requires the host's applicable plugin access to be enabled before installation can succeed.

Install/connect it in ChatGPT or Codex, then authorize your own Supabase account and project. Workspace access rules remain in force; this is not a way to bypass administrator restrictions. Package creation alone does not authenticate the account or prove tools are available. Live schema/tool discovery remains pending until connection succeeds.

The hosted ERP remains on GitHub Pages and Supabase. This plugin is for development/administration, not for customers or ordinary employees. See `docs/OPERATIONS-RELEASE.md` in the parent repository for the prepared backend activation steps.
