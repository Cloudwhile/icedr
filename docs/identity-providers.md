# Identity Provider Boundary

ICEDR treats external authentication as a provider adapter feeding one local
identity flow. The core auth service owns state validation, local user lookup,
session creation, and share callback handling. Provider adapters only own
authorization URLs, code exchange, and user profile mapping.

## Supported Profiles

`oidc` is the recommended production profile. It uses the standard OIDC code
flow through `openid-client` and maps claims or UserInfo into:

- `provider`: `oauth`
- `subject`: OIDC `sub`
- `email`: provider email when present
- `displayName`: `name`, `preferred_username`, or a fallback display name

`icetowne-blog` is a compatibility profile for the legacy ICETOWNE Blog OAuth
shape. It uses the Blog OAuth request-token, token, and userinfo endpoints and
maps legacy user fields into the same local identity shape:

- `provider`: `icetowne-blog`
- `subject`: `sub`, `id`, `ID`, `user_id`, or `userId`
- `email`: `email` or `user_email` when present
- `displayName`: `name`, display-name fields, login fields, or a fallback

## Email Mapping

Provider emails are normalized to lower case and must look like an email
address. If a provider does not return an email, ICEDR creates a deterministic
address under `identity.local` from the provider profile and subject. That
address is only an identity key fallback; it should not be treated as a
deliverable mailbox.

## Adding ICA Or Another OIDC Provider

Standard ICA or any OIDC-compatible provider should use the `oidc` profile with
the provider issuer URL, client ID, optional client secret, audience, scopes,
and redirect URI. No core auth flow changes should be needed.

If a provider is not OIDC-compatible, add a new adapter that returns the same
mapped user fields and keep the auth service flow unchanged.

## Configuration

Local defaults live in `.env.example`:

- `ICA_OAUTH_PROVIDER_PROFILE=oidc`
- `ICA_OAUTH_ISSUER_URL`
- `ICA_OAUTH_CLIENT_ID`
- `ICA_OAUTH_CLIENT_SECRET`
- `ICA_OAUTH_AUDIENCE`
- `ICA_OAUTH_SCOPES=openid email profile`
- `ICA_OAUTH_REDIRECT_URI`

The setup and admin settings screens expose the current profile mode as a short
status label: `Standard OIDC` or `Compatibility mode`.
