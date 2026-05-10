# DSE Platform Deployment Notes

## Frontend config

Copy `config.example.js` to `config.js`, then fill in your Supabase project URL and publishable key.

```js
window.DSE_SUPABASE_CONFIG = {
  url: 'https://YOUR_PROJECT_REF.supabase.co',
  publishableKey: 'YOUR_SUPABASE_PUBLISHABLE_KEY',
};
```

Only publishable keys belong in browser code. Never put a `service_role` key in `config.js`, `index.html`, or any public file.

## Supabase

Run `supabase-question-schema.sql` in the Supabase SQL editor before using the app. The DSE tables use RLS:

- Public reads: active `dse_texts`, active `dse_questions`, display-only `dse_leaderboard_entries`.
- Signed-in student reads/writes: own `dse_profiles`, own `dse_practice_rounds`, own `dse_practice_answers`.
- Private leaderboard triggers live in the `private` schema.

## Supabase Auth

If students should register and log in immediately without any verification code or confirmation email, turn off email confirmations in Supabase:

`Authentication -> Providers -> Email -> Confirm email` off.

Password reset still uses Supabase's secure email link. The app does not ask for a verification code: students enter their email, open the reset link, then set a new password in the app. For privacy, the reset screen does not reveal whether an email address exists.

## Google Sheets sync

In Apps Script project settings, add:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

The service role key is only for Apps Script server-side syncing. Teammates should edit the Google Sheet, then use `DSE Question Bank -> Sync to Supabase`.

Question rows may include a per-question `difficulty` for performance analysis. The website's `簡易`, `普通`, `大師`, and `地獄` choices are practice modes only: they randomly draw 10, 20, 25, or all questions from the selected article pool.

## Vercel / Zeabur

This is a static frontend. Use:

- Build command: leave empty / none
- Output directory: project root
- Required public files: `index.html`, `styles.css`, `app.js`, `supabase-client.js`, `config.js`

After deployment, add the production URL in Supabase:

- `Authentication -> URL Configuration -> Site URL`
- `Authentication -> URL Configuration -> Redirect URLs`

Use the deployed URL, for example `https://your-app.vercel.app`.

## Smoke verification

- Guest can practice, but no score is saved.
- Signed-in student can practice and see history.
- `option_a` remains the correct answer in Sheets, while website options are shuffled.
- Leaderboard displays nickname only, not full name, email, or user ID.
