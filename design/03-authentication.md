# Authentication

## Goal

Let the user access the same notes from several devices. The app does not store passwords.

## Sign in

Cloudflare Access decides who may use the app. Its policy is configured to allow the intended user.

Access protects only `/api/auth/login` and `/api/auth/session`. The app shell and other API routes are outside Access; the Worker protects those API routes with the app session. Protecting all routes would make synchronization depend on the shorter-lived Access session.

When the app needs a session, the Worker verifies the Access token and creates one. Every identity allowed by Cloudflare Access can access the same notes.

The sign-in button navigates to `/api/auth/login` so Cloudflare can complete authentication in the browser. After returning to the same page, the app checks its session and creates one through `/api/auth/session` only if needed. An expired Access session does not interrupt an existing app session or synchronization.

## App session

The app creates two random session secrets that expire after 30 days. D1 stores only their hashes. The browser keeps both in `Secure`, `SameSite=Strict`, host-only cookies. JavaScript can read one cookie; the other is `HttpOnly`.

Normal API requests require both secrets. Clearing local data deletes the JavaScript-readable cookie, so the `HttpOnly` cookie cannot be reused by itself. Requests that change data must come from the app's own origin.

## Signed out

The app always loads notes from IndexedDB. A signed-out user can create, edit, and delete local notes. These changes stay pending until the user signs in.

The sync message shows the sign-in state. When signed out, the sync button becomes a sign-in button. Only server synchronization requires an app session.

The app validates the session with the Worker at startup and whenever the installed app becomes visible or reconnects. Until a check succeeds or the Worker explicitly rejects it, the session is unknown and the user can retry the check. A temporary request failure preserves an already validated session so synchronization can keep retrying.

The auth store owns the session lifecycle. All authenticated requests report the Worker's `session_required` response through it, including attachments and session management. Shared HTTP handling knows nothing about auth state or encryption; the note API handles encryption and note-specific failures. Sync and UI consume the resulting session state.

Signing out cancels pending sign-in intent and prevents unfinished checks from restoring the session. If a session creation request is already underway, its late cookies are cleared before another sign-in can start.

## Session management

Each successful sign-in creates a separate session. It records a readable device and browser label for that sign-in. The sessions page shows one entry for each sign-in and can sign out one entry or all entries.

The label helps people recognize a session, but it does not identify a physical device or group sessions. Someone who still has Cloudflare Access can sign in again after a session is revoked.

Local development uses a built-in identity instead of Cloudflare. It still creates and validates both app session secrets. The cookie omits `Secure` because the local server uses HTTP.

## Encryption

Authentication controls access to the API but never supplies or stores the vault encryption key. Each trusted browser imports the same recovery key independently. Revoking a session prevents future API access but cannot erase plaintext or keys already held by that browser.
