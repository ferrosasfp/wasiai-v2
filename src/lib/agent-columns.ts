// Public column list for the `agents` table — every column EXCEPT `webhook_secret`.
//
// SECURITY (audit 2026-07-05): `webhook_secret` is a per-agent Bearer credential
// the platform uses to authenticate OUTBOUND calls to the agent's endpoint. The
// `agents_public_read` RLS policy exposes the full row to the `anon` role, so any
// `select('*')` executed with the public anon key leaked `webhook_secret` (49
// agents). Reads that legitimately need the secret already use `createServiceClient`
// (service_role bypasses RLS + column grants). Anon/catalog reads must therefore
// use THIS list and never `*`, so a column-level `REVOKE SELECT (webhook_secret)
// ... FROM anon, authenticated` can close the leak without breaking the catalog.
//
// Keep in sync with the `agents` table if columns are added (new public columns
// go here; new secrets stay out and get their own service-only access).
export const AGENT_PUBLIC_COLUMNS =
  'id, creator_id, name, slug, description, category, price_per_call, currency, chain, ' +
  'endpoint_url, capabilities, metadata, status, is_featured, total_calls, total_revenue, ' +
  'created_at, updated_at, on_chain_registered, marketplace_address, erc8004_id, creator_wallet, ' +
  'dependencies, agent_type, mcp_tool_name, mcp_description, reputation_score, reputation_count, ' +
  'cover_image, free_trial_enabled, free_trial_limit, tags, search_vector, max_rpm, max_rpd, ' +
  'creator_price, long_running, registration_type, token_id, chain_registered_at, sandbox_enabled, ' +
  'is_verified, input_schema, output_schema, health_check, last_checked_at, performance_score, ' +
  'consecutive_failures';
