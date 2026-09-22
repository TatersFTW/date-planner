# Our dates

A private date planner for two people. Either of you can suggest a date, the other answers,
and everything collects in a searchable history with ratings and memories.

There is no account and no company server holding your plans. Each of you keeps a full copy
on your own device. With cloud sync turned on (see below), changes reach your partner
automatically through a free database that only ever stores encrypted, unreadable text.
Without it, the app still works fully by swapping links.

## Files

| File | What it does |
| --- | --- |
| `index.html` | The page shell. Loads the files below in order. |
| `style.css` | All the styling. |
| `js/util.js` | Small helpers: DOM builder, dates, storage, toast, clipboard. |
| `js/crypto.js` | Compress and encrypt (AES-GCM, key from your password via PBKDF2). |
| `js/model.js` | What a date is, and the rules for merging two copies. |
| `js/state.js` | The shared space on this device and every way to change it. |
| `js/sync.js` | Builds and opens the encrypted links and backups. |
| `js/cloud.js` | Automatic sync over Firestore. Does nothing until you configure it. |
| `js/firebase-config.js` | Your free Firebase project's keys. Empty by default. |
| `js/parts.js` | Reusable interface pieces and the header. |
| `js/pages-dates.js` | View Dates and Create Date. |
| `js/pages-history.js` | The History page. |
| `js/pages-sync.js` | Sync and backup, first-time setup, password screen. |
| `js/app.js` | Start-up, page routing, incoming links. |

## Run it locally

Use VS Code's Live Server extension, or run `npx serve` in this folder.
(Encryption needs `https` or `localhost`.)

## Deploy

Netlify: drag this whole folder onto your site's Deploys tab.
GitHub Pages: push the folder to a public repo, then Settings, Pages, deploy from `main`.

You only need to do the cloud sync setup below once, on your own computer, before deploying.
Because you both open the same deployed site, you'll both get cloud sync automatically —
your partner doesn't set up anything.

## Turning on cloud sync

This uses Firebase, a free service from Google. Its free tier (called Spark) covers this kind
of use comfortably with no card required.

1. **Create a project.** Go to [console.firebase.google.com](https://console.firebase.google.com),
   click **Add project**, give it any name, and finish the wizard (you can skip Google Analytics).
2. **Turn on Firestore.** In the left menu, open **Build → Firestore Database**, click
   **Create database**, choose a location close to you, and start in **test mode** for now
   (we'll lock it down in the next step).
3. **Set the security rules.** Still in Firestore, open the **Rules** tab, replace the contents
   with the block below, and click **Publish**:
   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /datePlannerSpaces/{spaceId}/members/{member} {
         allow read, write: if true;
       }
     }
   }
   ```
   **What this means:** anyone who had your invite link (specifically, the random space ID
   inside it) could write to that one document. They still couldn't read your plans, because
   only encrypted text is ever stored there — your password never leaves your browsers, and
   Firebase never sees it. This is the same trust level as the plain link/backup system this
   app already has; cloud sync just moves the encrypted text automatically instead of you
   copying it. If you want stricter rules later, add Firebase Authentication and change this
   rule to check `request.auth != null`, which `js/cloud.js` doesn't currently use but could
   be extended to.
4. **Get your config.** Back on the project's main page (click the gear icon, **Project
   settings**), scroll to **Your apps**, click the **</>** (web) icon, register an app with any
   nickname, and skip Firebase Hosting. Copy the `firebaseConfig` object it shows you.
5. **Paste it in.** Open `js/firebase-config.js` in this folder and replace the `null` with
   the object you copied, so it looks like:
   ```js
   window.DP_FIREBASE_CONFIG = {
     apiKey: "AIza...",
     authDomain: "your-project.firebaseapp.com",
     projectId: "your-project",
     storageBucket: "your-project.appspot.com",
     messagingSenderId: "...",
     appId: "..."
   };
   ```
6. **Deploy.** Push or drag the updated folder to your host. Open the site, and the Sync page
   should show **Automatic sync: Connected**. Send your partner the invite link once, as
   before; after that, changes on either side reach the other on their own.

The free tier's limits are generous for two people planning dates (tens of thousands of
reads and writes a day); you won't come close.

## How syncing works

- **Cloud sync**, once configured: each of you keeps one small document in Firestore holding
  your latest full, encrypted plan. Your device listens to your partner's document and merges
  it the moment it changes.
- **Manual fallback**, always available from the Sync page: an update link (recent changes) or
  full link (everything), and a downloadable encrypted backup.
- **Merging never loses anything**, in either case: each of you writes your own answers and
  memories, edits to a date use "last edit wins", and deletes travel as markers. Applying the
  same data twice, or in any order, gives the same result.

## Growing this later

- **Data format changes**: bump `SCHEMA` in `js/model.js` and add an upgrade step in
  `migrate()` in `js/state.js`. Old saved data, old backups, and old cloud documents keep working.
- **A different cloud backend**: only `start()`, `stop()` and `pushNow()` in `js/cloud.js` know
  about Firestore. Point them at a different database and nothing else in the app changes.
- **New categories**: add to `KINDS` in `js/model.js`.
