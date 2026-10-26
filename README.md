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
5. Run [`supabase/streak.sql`](./supabase/streak.sql) to create the daily Movie-of-the-Day streak history table and its per-user row security policies.
6. Run [`supabase/profile.sql`](./supabase/profile.sql) to enable profile pictures, banners, and favorite films with per-user profile policies and a public image bucket.
7. In Supabase Authentication settings, configure the site's local and deployed redirect URLs and choose whether email confirmation is required.
8. In Authentication → URL Configuration, add the local and deployed site URLs as allowed redirect URLs for password recovery and email confirmation.
9. Deploy the account-deletion Edge Function from the project root with the Supabase CLI: `supabase functions deploy delete-account`. Supabase supplies the function's server-side `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`; never put the service-role key in `.env` or browser code.
10. Restart the dev server. Use **SIGN IN** to create an account or sign in. Existing guest lists are merged into the account after sign-in.

Signed-in watchlists and watched films are stored in Supabase and are available on other devices after signing in. Guest watchlists and watched films stay in browser localStorage; each is merged into the matching account table on sign-in and cleared from local storage after a successful migration. Signing out returns to guest mode with separate local-only lists.

The daily streak counts consecutive UTC dates on which the Movie of the Day is marked watched. Random movies do not extend it. Guest streaks stay in browser localStorage and merge into the account after sign-in; account streak history syncs across devices. Existing watched movies are not backfilled into streak history.

Choosing **WATCHED** opens a small rating/review dialog. A half-star rating and optional review are saved with the film when you confirm; you can also skip the review or cancel. The Watched page lets you adjust or clear ratings and displays saved review text. Ratings/reviews use the existing watched movie data in localStorage or the user's Supabase row, so no additional SQL setup is needed. After saving, the app finds another random film. Future random selections exclude the user's saved watched films, today's pick, and random picks already shown during the current visit. The deterministic Movie of the Day remains the same for everyone.

The Profile page shows a personal film print with watched count, average rating, liked-film count, and your three highest-rated films. Profile settings let you upload a picture and banner and select up to four favorite films through TMDB search. Profile images are resized to WebP and stored in the public `profile-media` Supabase bucket for signed-in accounts; guest profile data is kept in localStorage. Run `supabase/profile.sql` before using account profile customization. Profile settings can also import a Letterboxd diary CSV into the watched-film list. Export your data from Letterboxd, then choose the CSV in the app. Entries are matched through TMDB using exact normalized title and release year; unmatched or ambiguous entries are skipped, and duplicate/already-watched films are not added again. Imports are limited to 500 unique entries per file.

Account settings include password-reset email, password update after following its link, and a confirmed account deletion. Deletion uses the deployed Edge Function so the service-role key remains server-side. TMDB API/image failures and synced-list failures show retry actions.

TMDB attribution is shown in the app footer using the official logo asset from `public/tmdb-logo.svg` and the required non-endorsement notice. Keep TMDB's logo less prominent than this app's identity. The free developer API is for non-commercial use; confirm your specific public movie-discovery website with TMDB before launch. Do not add ads or other monetization without the required written commercial agreement.
