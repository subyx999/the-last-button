# Button.

One film a day. A growing archive of everything you watch.

Button. is an experimental film-discovery project with an editorial cinema identity. Find your next watch, keep track of what you have seen, and build a record of your taste.

**Live site:** [the-last-button.vercel.app](https://the-last-button.vercel.app/)

## What you can do

- Get a **Movie of the Day**. The UTC date seeds TMDB discovery searches spanning mainstream, underseen, classic-era, and international films; the same deterministic choice from those results is featured for everyone on that date.
- Find **random films**; saved watched films, today's pick, and films already shown during the visit are excluded.
- **Search** for films and browse recommendations by genre.
- Keep separate **Watchlist**, **Watched**, and **Likes** collections. Add half-star ratings and optional reviews to watched films.
- Build a **profile** with a picture, banner, up to four favorite films, and a summary of your watched films and ratings.
- Track a **daily streak** by marking the Movie of the Day watched.
- Import a **Letterboxd diary CSV** into your watched films.
- Use the app as a guest, or sign in to sync your collections and profile across devices.

## Stack

React 19 · TypeScript · Vite · Supabase · TMDB API

## Run locally

### Requirements

- Node.js 18 or newer
- A [TMDB API key](https://www.themoviedb.org/settings/api)

### Setup

```sh
git clone https://github.com/subyx999/the-last-button.git
cd the-last-button
npm install
```

Copy `.env.example` to `.env` and set `VITE_TMDB_API_KEY`. To enable account features locally, also set the Supabase values:

```dotenv
VITE_TMDB_API_KEY=your_tmdb_api_key
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

Then start the development server:

```sh
npm run dev
```

All `VITE_` variables are included in browser code. The TMDB API key and Supabase URL and anon/publishable key must be treated as public; never put a Supabase service-role key or other privileged secret in `.env` or client-side code.

## Supabase accounts

Supabase is optional. Without it, the app works as a guest and saves data in that browser's `localStorage`. To enable accounts and cross-device sync:

1. Create a [Supabase project](https://supabase.com/), then set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as above.
2. In the Supabase SQL Editor, run these project scripts:

   | File | Creates |
   | --- | --- |
   | [`supabase/schema.sql`](./supabase/schema.sql) | Watchlist and row-level security policies |
   | [`supabase/watched.sql`](./supabase/watched.sql) | Watched films and row-level security policies |
   | [`supabase/likes.sql`](./supabase/likes.sql) | Liked films and row-level security policies |
   | [`supabase/streak.sql`](./supabase/streak.sql) | Daily streak history and row-level security policies |
   | [`supabase/profile.sql`](./supabase/profile.sql) | Profile data and the public `profile-media` image bucket |
3. In **Authentication → URL Configuration**, set the Site URL to `https://the-last-button.vercel.app` for production and add the production and local app URLs to **Redirect URLs**. For local development, allow `http://localhost:5173/**`. Password recovery redirects to the app root with `?flow=recovery`.
4. The app supports email/password and Google sign-in. To use Google sign-in, enable the Google provider in Supabase Auth, enter its client credentials, and add the callback URL shown by Supabase to your Google OAuth client. Email confirmation can be configured in Supabase Auth.
5. To enable account deletion, install and authenticate the [Supabase CLI](https://supabase.com/docs/guides/cli), link it to your project, then deploy the Edge Function from the repository root:

   ```sh
   supabase functions deploy delete-account
   ```

   Supabase provides the function's server-side `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. Keep the service-role key in Supabase, never in the app's environment file or browser code.

Guest collections and profile data remain separate from account data after signing out. On sign-in, guest data is merged into the matching account collections and removed from local storage after a successful migration. Likes are independent of both Watched and the Watchlist. Streaks count consecutive UTC dates when the Movie of the Day is marked watched; random films do not count, and earlier watched films are not backfilled.

Profile images are converted to WebP and stored in the public `profile-media` bucket. Letterboxd imports match titles and release years through TMDB; unmatched or already-saved films are skipped. Each CSV is limited to 5 MiB (5,242,880 bytes) and 500 unique title/year entries.

## Build and deploy

Run `npm run build` to type-check and create the static production build in `dist/`. Deploy that output with a static hosting provider. Set the required `VITE_` environment variables in the host's build environment; Supabase is only needed if enabling account features. For account deletion, deploy the Supabase Edge Function separately as described above.

## TMDB attribution

This product uses the TMDB API but is not endorsed, certified, or otherwise approved by TMDB. The app includes TMDB attribution and its official logo; keep the logo less prominent than Button.'s identity. The free developer API is for non-commercial use. Confirm that your specific public website is permitted before launch, and do not add monetization without the required written commercial agreement.
