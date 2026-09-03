# Authentication

## Goal

Let the user access the same notes from several devices. The app does not store passwords.

## Sign in

Cloudflare Access decides who may use the app. Its policy is configured to allow the intended user.

When the app needs a session, the Worker verifies the Access token and creates one. Every identity allowed by Cloudflare Access can access the same notes.

## App session

The app creates two random session secrets that expire after 30 days. D1 stores only their hashes. The browser keeps both in `Secure`, `SameSite=Strict`, host-only cookies. JavaScript can read one cookie; the other is `HttpOnly`.

Normal API requests require both secrets. Clearing local data deletes the JavaScript-readable cookie, so the `HttpOnly` cookie cannot be reused by itself. Requests that change data must come from the app's own origin.

## Signed out

The app always loads notes from IndexedDB. A signed-out user can create, edit, and delete local notes. These changes stay pending until the user signs in.

The sync message shows the sign-in state. When signed out, the sync button becomes a sign-in button. Only server synchronization requires an app session.

## Session management

Each successful sign-in creates a separate session. It records a readable device and browser label for that sign-in. The sessions page shows one entry for each sign-in and can sign out one entry or all entries.

The label helps people recognize a session, but it does not identify a physical device or group sessions. Someone who still has Cloudflare Access can sign in again after a session is revoked.

Local development uses a built-in identity instead of Cloudflare. It still creates and validates both app session secrets. The cookie omits `Secure` because the local server uses HTTP.
