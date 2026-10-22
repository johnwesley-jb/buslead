# Google Calendar setup (personal Gmail)

Buslead connects to **one** Google account and **one** calendar. It reads busy times and creates, moves and deletes the
events it made. Scopes requested: `calendar.events`, `calendar.calendarlist.readonly`, `openid`, `email`.

## 1. Create the Google Cloud project

1. Go to <https://console.cloud.google.com/> and create a project (for example `buslead`).
2. **APIs & Services → Library →** search **Google Calendar API → Enable**.

## 2. OAuth consent screen

1. **APIs & Services → OAuth consent screen** (menu names can differ slightly: "Google Auth Platform" in newer consoles).
2. User type **External**. App name `Buslead`, your Gmail as support and developer contact.
3. **Scopes:** add `.../auth/calendar.events` and `.../auth/calendar.calendarlist.readonly` (openid and email are added automatically).
4. **Publishing status: Testing.** Under **Test users**, add the Gmail address you will connect (and any other you need).

## 3. OAuth client

1. **Credentials → Create credentials → OAuth client ID → Web application**.
2. **Authorized redirect URIs:** `http://localhost:4000/api/calendar/callback` (must match `GOOGLE_REDIRECT_URI` exactly).
   Google allows `http://localhost` redirects, so the tunnel is **not** needed for this step.
3. Copy the client ID and secret into `.env` as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. Restart the API.

## 4. Connect

1. Sign in to the dashboard as an admin and open **Settings → Google Calendar → Connect**
   (the dashboard calls `POST /api/calendar/connect` and navigates to the returned Google URL).
2. Choose the Gmail account. Because the app is unverified you will see "Google hasn't verified this app": **Advanced → Go to Buslead (unsafe)**. This is expected for your own app in Testing.
3. Allow calendar access. You return to the dashboard; pick the calendar to use (a dedicated calendar such as "Buslead appointments" is cleaner than your primary one).

## The 7-day limit (important)

While the OAuth app is in **Testing**, Google expires its refresh tokens **after 7 days**. The dashboard shows that date
(`tokenExpiresAt`) and the connection flips to `needs_reauth`; new bookings are paused (callers hear that the team will call back, and
details are still saved) until an admin clicks **Reconnect**. Options:

* **Accept it** while testing and reconnect weekly (one click).
* **Publish the app** (consent screen → *Publish app*). For sensitive scopes Google requires verification (privacy policy, homepage, demo video) before the "unverified" screen disappears; without verification, published apps are limited to 100 users and still show the warning, but refresh tokens stop expiring after 7 days. Check Google's current rules before relying on this.
* **Use a Google Workspace account** and set the app's user type to **Internal**: no verification, no 7-day expiry.

Set `GOOGLE_OAUTH_TESTING_MODE=false` in `.env` once you are no longer in Testing so the dashboard stops showing the expiry date.

## What gets written to your calendar

Each appointment becomes one event: title `Follow-up: <name>`, description with reason/phone/email and a link back to the dashboard,
default reminders, no attendees (nobody receives an invitation). Event IDs are derived from the appointment ID, so a retry can never
create a duplicate. Events are tagged with a private property so Buslead only ever touches its own.

* Busy time = all non-cancelled events that are not marked **Free**, plus all-day events not marked Free, minus events you declined.
* If you delete a Buslead event by hand, the 30-minute reconcile job flags the appointment *Rescheduling required*.
* If you drag a Buslead event to another time in Google, reconcile updates the appointment to match (unless that overlaps another appointment).

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `redirect_uri_mismatch` | The URI in the Google client differs from `GOOGLE_REDIRECT_URI` (scheme, port and path must match exactly). |
| "Access blocked: app not verified / not completed verification" | Your Gmail is not in **Test users**. |
| Connect succeeds but Buslead says no long-lived token | Remove Buslead at <https://myaccount.google.com/permissions> and connect again. |
| `needs_reauth` after a week | The 7-day Testing limit above. |
| Calendar not in the list | Only calendars where you can edit events are listed. |
