# Rental Management

A mobile-friendly web app for lending company items between branches and departments.
Each physical item has its own QR code. **Everyone signs in with Google.**

- **Staff** (anyone who signs in): browse items or scan an item's QR code, request to borrow it,
  follow their requests under **My requests**, and request a return.
- **Admins**: manage items, approve/reject requests, confirm handovers and returns, keep the
  maintenance log, print QR labels, export CSV, and manage users (make admin, block, approve).

Tech: React + TypeScript + Vite (`src/`) · one Netlify Function for `/api/*` (`netlify/functions/api.ts` →
`server/`) · Firebase Firestore (only the server talks to it, via the Admin SDK) · Firebase Authentication
with **Google sign-in**.

---

## 1. Run it on your computer

Open **Windows PowerShell** in the project folder (VS Code: *Terminal → New Terminal*):

```powershell
cd "$HOME\OneDrive\Desktop\RentalManagement_DB"
npm.cmd install
npm.cmd run dev
```

Open **http://localhost:5173**. `npm.cmd run dev` starts the interface **and** the backend API together
(the API runs inside the Vite dev server, using the same code as the Netlify Function). Stop with `Ctrl + C`.

> Use `npm.cmd` / `npx.cmd` instead of `npm` / `npx` so PowerShell's execution policy doesn't block you.

**First time?** Copy `.env.example` to `.env` (`Copy-Item .env.example .env`) and fill it in (section 2).
To try the app without Firebase, set `BACKEND_MODE=memory`: data then lives only in the dev server's
memory (lost on restart), a yellow banner is shown, and the app refuses to run that way on a deployed site.

**Testing on an Android phone over USB:** see section 8.

---

## 2. Firebase setup (project ID: `rentalmanagement-db`)

1. **Firestore rules:** Firestore Database → Rules → paste [`firestore.rules`](firestore.rules) (deny all) →
   Publish. Browsers never access Firestore directly; never "fix" a permission error by opening the rules.
2. **Google sign-in:** Authentication → Sign-in method → **Google** → Enable → choose a support email → Save.
3. **Web app config (not secret):** Project settings → General → Your apps → `</>` (Web) → copy `apiKey`,
   `authDomain`, `projectId`, `appId` into `.env` as `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`,
   `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID`.
4. **Server key (SECRET):** Project settings → Service accounts → Generate new private key. Keep the downloaded
   `.json` **outside** the project folder. Copy `client_email` → `FIREBASE_CLIENT_EMAIL` and `private_key`
   (one line, with its `\n` characters, inside double quotes) → `FIREBASE_PRIVATE_KEY`.
5. Check everything (read-only — never writes, never prints secrets):

   ```powershell
   npm.cmd run check:firebase
   ```

6. After deploying, add your site's domain under Authentication → Settings → **Authorized domains**
   (`localhost` is already there).

Problems are shown as clear messages in the app and in the check (wrong key, database not found, Google
sign-in disabled…). The app never falls back to fake or browser-stored data.

---

## 3. Accounts (admins register people — no self sign-up)

Only people an admin has **registered** can sign in. Everyone signs in with Google (no passwords).

1. **Admin → Users → Register a person:** enter their Google email (Gmail or company Google Workspace) and
   choose **Staff** or **Admin**. They appear under "Waiting for first sign-in" (you can remove it there).
2. The person opens the site and taps **Sign in with Google**. Their account is created with that role.
   Unregistered Google accounts are refused ("This Google account is not registered…") and nothing is stored.
3. **Staff** must then complete their **profile** before using the system: email (read-only, from the
   registration), full name, phone and department (Rubix Technology, Asiah Hisam (Litigation),
   Asiah Hisam (Conveyancing), Ana Travel, AFC Mortgage, SANCO). Borrow requests use these details.
   Anyone can edit their profile later by clicking their name in the header.

**The very first admin** (fresh database, nobody can open Admin → Users yet), in PowerShell:

```powershell
npm.cmd run user:make-admin -- your.name@gmail.com
```

This registers the email as admin (or promotes the account if it already exists). Then sign in with Google.
Other commands: `user:make-staff`, `user:block`, `user:unblock` (each `-- email`), and `user:list`.
The system always keeps at least one active admin (the last admin can't be demoted or blocked).

Note: Firebase Authentication itself may still list a Google account that tried to sign in without being
registered (that's how Google sign-in works), but the app refuses it and stores no account or data for it.

**Local test sign-in (development only):** with `DEV_STAFF_LOGIN=true` the login page also shows
"Test admin" / "Test staff" buttons (accounts from `DEV_ADMIN_EMAILS` / `DEV_STAFF_EMAILS`), no password.
Only works on `localhost`, test accounts are never stored, and the server refuses to start with it on a
deployed site. Set it to `false` once Google sign-in works.

---

## 4. Environment variables

| Variable | Used | Needed at | Purpose |
|---|---|---|---|
| `BACKEND_MODE` | server | runtime | `firebase` (default, required when deployed) or `memory` (local only) |
| `PUBLIC_BASE_URL` | server | runtime | Address printed in QR codes, e.g. `https://your-site.netlify.app`. Leave it **unset** on a test/draft site: the app then uses the address people opened. A `localhost` value is ignored on deployed sites. |
| `APP_TIMEZONE` | server | runtime | Time zone for "today" and overdue, e.g. `Asia/Kuala_Lumpur` (default `UTC`) |
| `DEV_STAFF_LOGIN`, `DEV_ADMIN_EMAILS`, `DEV_STAFF_EMAILS` | server, local only | — | Passwordless test sign-in. **Never** set on Netlify (the server refuses to start). |
| `FIREBASE_PROJECT_ID` | server | runtime | `rentalmanagement-db` |
| `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` | server, **secret** | runtime | Service account |
| `FIRESTORE_DATABASE_ID` | server, optional | runtime | Only if your database isn't named `(default)` |
| `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID` | browser | **build time** | Public web-app config, copied into the built app. Must exist on Netlify *before* the build; changing them needs a new deploy. |

"Runtime" variables are read by the Netlify Function on every request (changing them takes effect on the
next deploy/restart of the function). On Netlify, give secrets the **Functions** scope only.

Never prefix server secrets with `VITE_` — anything starting with `VITE_` is sent to the browser.
`.env` and service-account files are git-ignored.

---

## 5. How it works

**QR codes** → `PUBLIC_BASE_URL/item/<itemId>`. Scanning opens the item page (after Google sign-in if
needed). Scanning **never** borrows, returns or changes anything. The code is permanent for the item and
reused for every loan. ⚠ Labels printed while `PUBLIC_BASE_URL` is `localhost` won't open on other phones.

**Borrowing workflow**

```
Staff requests ─► Pending ──approve──► Approved ──confirm handover──► On loan
                    │  └─reject─► Rejected       │                   │  │
                    └─cancel─► Cancelled ◄─cancel┘     staff "I'm returning"
                                                                     ▼  │
                                                         Return requested│ admin can confirm directly
                                                    admin inspects ──┴──┴─► Returned
                                                   item → Available or Under maintenance
```

- Approval is **not** handover: the item only becomes "On loan" when an admin confirms the handover.
- A return request doesn't make the item available — only the admin confirming receipt does.
- One request holds an item at a time; items on loan or reserved can't be deactivated.
- Deactivated items are hidden but all history is kept. Nothing is deleted.
- All changes are database transactions: two admins pressing "Confirm handover" together record one
  handover; double-clicks never create duplicates.
- **Overdue** = on loan past the expected return date. No fees.

**Privacy:** staff only ever see their own requests. Item pages never show who is borrowing. Admin notes,
condition notes, serial numbers, storage locations and the maintenance log are admin-only.

**Admin extras:** maintenance log per item; CSV export of items and requests (contains contact details —
keep private; formula-looking cells are neutralised); automatic item codes (leave the code blank → e.g.
`PROJ-001`); QR labels with copies and sizes; activity history of who did what and when.

---

## 6. Tests

```powershell
npm.cmd test
```

Automated tests cover: sign-in required everywhere (401) · staff refused on every admin action (403) ·
only Google sign-in accepted · unregistered accounts refused, blocking, promoting, last-admin protection ·
staff see only their own requests · admin notes / condition notes never reach staff · item pages never
reveal borrowers · invalid status transitions rejected · duplicate and concurrent actions safe · returns
don't free the item until confirmed · rate limits · automatic item codes · maintenance log · CSV safety ·
configuration errors are clear and memory/test modes are refused on deployed sites · admin-only registration
and staff profiles · QR handover codes · the service worker never caching API/sign-in/other sites ·
localhost QR addresses ignored on deployed sites.

Also: `npm.cmd run typecheck`, `npm.cmd run build`.

---

## 7. Deploying to Netlify

1. Give this project its **own** Git repository (currently your whole Desktop is one) and push it to GitHub.
2. Netlify → Add new site → Import from GitHub. Settings come from [`netlify.toml`](netlify.toml).
3. Site configuration → Environment variables: add the section 4 variables with real values —
   `BACKEND_MODE=firebase`, `PUBLIC_BASE_URL=https://<your-site>.netlify.app`, **no** `DEV_STAFF_LOGIN`.
   Paste `FIREBASE_PRIVATE_KEY` as one line with `\n`, without surrounding quotes.
4. Deploy, then add the Netlify domain to Firebase → Authentication → Settings → Authorized domains.
5. Only then print QR labels.

6. Netlify region: if your plan allows it, set the Functions region to **Singapore (ap-southeast-1)**,
   next to the Firestore database (`asia-southeast1`). Otherwise every database call crosses the Pacific.

Routing (see [`netlify.toml`](netlify.toml)): `/api/*` goes to the function first (its `config.path`),
real files such as `sw.js` and `manifest.webmanifest` are served as-is, and every other path (deep links,
QR links, refreshes) loads the app.

Alternative local run that mimics Netlify: `npx.cmd netlify-cli@latest dev` → http://localhost:8888.

---

## 7b. Installable app (PWA)

- **Manifest** `public/manifest.webmanifest`, **icons** in `public/icons/` (regenerate with
  `node scripts/generate-icons.mjs`).
- **Service worker** `pwa/sw.js` is written to `dist/sw.js` at build time with that build's file list and
  a version ID. It is registered in **production builds only** (`npm run dev` never caches).
- **What it caches:** only the app's own static files (built JS/CSS, icons, manifest, the app shell).
  **Never** `/api/*`, sign-in, Google/Firebase or any borrower data. Writes always go to the network.
- **Offline:** the app still opens and shows "You're offline"; nothing can be sent or shown as saved.
- **Updates:** when a new version is deployed, installed apps show **Update available** (checked on open,
  when returning to the app, and every 30 minutes). Nothing reloads until the user taps **Update**, so
  unsaved forms aren't lost. Old caches are deleted when the new version takes over.
- `sw.js`, `manifest.webmanifest` and `index.html` are served with `no-cache` so updates are noticed;
  `/assets/*` (hashed names) are cached for a year.
- Test the production build locally with the real API: `npm.cmd run build` then `npx.cmd vite preview`
  → http://127.0.0.1:4173.

---

## 8. Testing on an Android phone (USB)

1. Phone: Settings → About phone → Software information → tap **Build number** 7×; then Developer
   options → **USB debugging** on. Connect the cable and tap **Allow**.
2. Computer: `npm.cmd run dev`, then in Edge open `edge://inspect/#devices` → **Port forwarding…** →
   port `5173` → `localhost:5173` → tick Enable → Done. Keep that tab open.
3. Phone (Chrome): open **http://localhost:5173**. Google sign-in and the camera scanner work there.

### Testing on phones over Wi-Fi (no cable)

1. Computer: `npm.cmd run dev:lan`. The terminal prints the address to open on the phone
   (e.g. `http://192.168.0.16:5173`) and a **test sign-in passcode** (new on every start — keep it private).
2. Phone on the **same Wi-Fi**: open that address, type the passcode, tap a test account.
   On the computer itself, `localhost` still needs no passcode.
3. In this mode QR codes point to the computer's Wi-Fi address instead of `localhost`, so phones can open them.

Notes:
- Plain `npm.cmd run dev` stays reachable only from the computer. The test sign-in is decided by the real network
  connection (not the `Host` header), so another device can't pretend to be `localhost`.
- **Camera scanner inside the app** needs HTTPS or localhost; `http://192.168.x.x` is not "secure" to the browser.
  Use the phone's own camera app to scan QR codes (they open the link in the browser), or in Chrome on the phone
  open `chrome://flags/#unsafely-treat-insecure-origin-as-secure`, add `http://192.168.0.16:5173`, and relaunch.
- **Google sign-in** from the Wi-Fi address needs it in Firebase Console → Authentication → Settings →
  Authorized domains (add `192.168.0.16`). The passcode test sign-in doesn't need this.
- Windows may ask to allow Node.js through the firewall the first time — allow it on **Private** networks only.

---

## 9. Limitations and open decisions

- No prices, deposits, fees or payments. No reservation calendar (dates are preferences). One item per request.
- No email/WhatsApp notifications — people check "My requests"; admins contact borrowers themselves.
- Two roles only (admin, staff). Finer permissions (e.g. per-branch admins) can be added later.
- Item photos are stored in Firestore (resized). Lists load up to ~500–2000 records.
- Requests made before Google sign-in was introduced have no linked account; admins still see them.

## Project structure

```
src/pages/public/    Browse, item page, request form, My requests
src/pages/admin/     Admin dashboard, items, requests, users, activity, labels
src/pages/           Login, Scan
src/auth/            Google sign-in (AuthProvider)
server/              API routes (handler.ts), security (backend.ts), services, validation
shared/types.ts      Types shared by browser and server
scripts/             user:* commands, check:firebase, seed:emulator
tests/               Automated tests
```
