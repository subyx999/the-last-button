# The Last Button

A deliberately small movie-discovery app: one deterministic Movie of the Day, a random movie button, and a local watchlist.

## Run locally

1. Install Node.js (18 or newer).
2. Copy `.env.example` to `.env` and set `VITE_TMDB_API_KEY` to a TMDB API key.
3. Run `npm install`, then `npm run dev`.

Vite exposes `VITE_` variables to the browser. Treat this key as public; do not use a privileged or secret server credential here.

The daily feature uses a UTC-date-based rotation through a fixed set of TMDB movie IDs, so a given UTC day yields the same pick across users. Trivia is not fabricated: until verified facts are curated, the interface labels available TMDB-derived information as metadata.

## Optional accounts and watchlist sync

The site works without an account. Guest watchlists stay in that browser's localStorage. To enable account sign-in and sync between devices:

1. Create a Supabase project.
2. Add the project's URL and public anon/publishable key to `.env` as `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. These client-side values are public; never use a service-role key in this app.
3. In the Supabase SQL Editor, run [`supabase/schema.sql`](./supabase/schema.sql) to create the watchlist table and per-user row security policies.
4. Run [`supabase/watched.sql`](./supabase/watched.sql) to create the separate watched-movie table and its per-user row security policies.
5. In Supabase Authentication settings, configure the site's local and deployed redirect URLs and choose whether email confirmation is required.
6. In Authentication → URL Configuration, add the local and deployed site URLs as allowed redirect URLs for password recovery and email confirmation.
7. Deploy the account-deletion Edge Function from the project root with the Supabase CLI: `supabase functions deploy delete-account`. Supabase supplies the function's server-side `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`; never put the service-role key in `.env` or browser code.
8. Restart the dev server. Use **SIGN IN** to create an account or sign in. Existing guest lists are merged into the account after sign-in.

Signed-in watchlists and watched films are stored in Supabase and are available on other devices after signing in. Guest watchlists and watched films stay in browser localStorage; each is merged into the matching account table on sign-in and cleared from local storage after a successful migration. Signing out returns to guest mode with separate local-only lists.

The **WATCHED** action marks the current film as watched, then finds another random film. Future random selections exclude the user's saved watched films, today's pick, and random picks already shown during the current visit. The deterministic Movie of the Day remains the same for everyone.

Account settings include password-reset email, password update after following its link, and a confirmed account deletion. Deletion uses the deployed Edge Function so the service-role key remains server-side. TMDB API/image failures and synced-list failures show retry actions.

TMDB attribution is shown in the app footer using the official logo asset from `public/tmdb-logo.svg` and the required non-endorsement notice. Keep TMDB's logo less prominent than this app's identity. The free developer API is for non-commercial use; confirm your specific public movie-discovery website with TMDB before launch. Do not add ads or other monetization without the required written commercial agreement.
