# Authentication with Cloudflare Access

## Goal

Allow only explicitly approved people to load the deployed app or access its note API, without storing passwords or implementing sessions in plain-note.

## Design

Cloudflare Access protects the entire deployed hostname and provides the sign-in flow, identity-provider integration, session, and optional MFA.

The Worker independently verifies the Access JWT on every `/api/*` request. It accepts only an RS256 token with the configured issuer and application audience. The JWT library also checks the signature and expiry. Missing or invalid tokens receive `401`; missing production configuration fails closed.

Requests to `localhost`, `127.0.0.1`, and `[::1]` bypass authentication so local development does not depend on Cloudflare.

Both layers are required: Access keeps unauthenticated users away from the application, while Worker verification prevents forged or misdirected tokens from reaching note data.
