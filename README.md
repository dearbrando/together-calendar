# Together — a calm family calendar

An installable web app (PWA). One person starts a calendar and gets a six-letter code;
everyone else enters the code (or taps the invite link) to join. No accounts, no sign-up.

- `public/` — the app (plain HTML/CSS/JS, no build step), service worker, icons, manifest
- `src/worker.js` — a Cloudflare Worker that serves the app and a tiny sync API.
  Each family is stored in its own Durable Object, keyed by its code.
- `preview/` — a single-file, device-only preview (no syncing)

## Put it online (free, about 10 minutes)

You need a free Cloudflare account (https://dash.cloudflare.com/sign-up).

### Option A — from GitHub, no terminal
1. Put this folder in a GitHub repository.
2. In Cloudflare: **Workers & Pages → Create → Import a repository**, pick the repo, keep the defaults
   (deploy command `npx wrangler deploy`), and click **Deploy**.
3. You get a link like `https://together-calendar.<your-name>.workers.dev`. Every push redeploys it.

### Option B — from your computer
1. Install Node.js 20+ (https://nodejs.org).
2. In this folder: `npm install`, then `npx wrangler login`, then `npx wrangler deploy`.

Cloudflare's free plan covers a family many times over.

## Sharing it as an app
1. Open the link on your phone and tap **Get started → Start a family calendar**.
2. Tap **Share invite**. Family members get a link that opens straight to the code screen.
3. On iPhone: Share → **Add to Home Screen**. On Android: menu → **Install app**.
   After that it opens full-screen from the home screen like any other app, and works offline.

## How syncing works
- Changes save on the device first, then sync within a second (and every 15 seconds,
  and whenever the app is reopened). Offline edits sync when you're back online.
- Each plan and person keeps its own "last changed" time; the newest change wins.
- The code is the key: anyone who has it can see and edit the calendar, so share it only with family.
  To start over with a new code, use **Family → Leave this calendar** and start a new one.

## Photos, files and kid-proofing
- Plans can carry up to 10 photos or files (10 MB each, about 1 GB per family). Photos are shrunk on the phone
  before upload. They are stored with your family's calendar on Cloudflare, so there's nothing extra to set up.
- **Parent code** (set during setup or in Family settings): once set, kids can change and remove only the plans
  they made; a phone unlocked with the parent code can change anything. "Lock this phone" turns kids mode back on.
  This keeps button-mashers from wiping your plans; it's a family guard rail, not bank-grade security.
- Removing a plan shows an **Undo** button for a few seconds.
- **Just me** (top right of the calendar) shows only your plans and whole-family plans.

## Reminders, lists and chores
- **Reminders:** a plan can remind people (when it starts, 10 minutes, 1 hour or a day before). Each phone turns
  reminders on once in Family settings. On iPhone this needs Together on the Home Screen (iOS 16.4 or newer).
  Reminders go only to the people in the plan (or everyone for whole-family plans). The server sends them itself,
  with keys it makes on its own, so there's nothing to configure.
- **Lists:** Groceries and To-do to start, plus any list you add. Anyone can add and tick off items.
- **Chores and tasks:** every day, every week on a chosen day, or just once (a task with an optional due
  date). Parents assign them to anyone; kids can add tasks for themselves and tick off their own. Streaks
  build up for repeating chores, and a "chores left today" nudge shows on the calendar.
- **Chore alerts:** pick an alert time and the assigned person's phone gets a notification at that time,
  only if it isn't done yet (and only on the chosen day for weekly chores, on the due date for tasks).
- **Month view:** the calendar opens on the whole month. Tap a day to see and add its plans; swipe or use
  the arrows to change month.

## Run locally
`npm install && npx wrangler dev` then open http://localhost:8787
