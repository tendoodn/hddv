# Tendoo Add-on License Portal

A separate account and licensing service for the invoice-lookup Chrome Add-on. This project is intentionally isolated from the Tendoo K application and its Supabase project.

## Decisions
- Dedicated Supabase project; do not reuse Tendoo K credentials or database.
- Plans: 7-day trial (once per normalized email), one calendar month, one calendar year.
- Paid subscriptions can be granted manually by the sole owner-admin or activated automatically after verified payment.
- VietQR is the payment presentation/transfer format. Automatic reconciliation requires a bank transaction feed/webhook provider (for example a supported bank webhook intermediary); a QR image alone cannot confirm that money arrived.
- Server time is authoritative for all expiry checks.
- The extension must call a server-side license-check endpoint/RPC. Never embed the Supabase service-role key or payment webhook secret in extension/browser code.

## Repository layout
- `supabase/migrations/001_addon_license_portal.sql`: initial isolated schema, RLS, trial claim, license status and admin grant RPCs.
- `public/`: customer portal frontend (to be added after project URL/anon key are configured).
- `supabase/functions/`: payment order creation, signed payment webhook adapter, and extension license validation (to be added for the chosen bank-feed provider).

## Initial setup
1. Create a brand-new Supabase project dedicated to the Add-on.
2. In its SQL Editor, run `supabase/migrations/001_addon_license_portal.sql`.
3. Register the first user account through Supabase Auth.
4. Using the Supabase SQL Editor as project owner, insert that account's UUID into `public.addon_admins`:
   ```sql
   insert into public.addon_admins(user_id)
   select id from auth.users where lower(email) = lower('YOUR_ADMIN_EMAIL');
   ```
   Run this once only for the single primary administrator.
5. Set the monthly/yearly prices in `addon_plans.price_vnd` after deciding the actual prices.
6. Configure SMTP/email verification and password reset in Supabase Auth.
7. Configure a VietQR-compatible bank transaction notification provider. Store provider secrets only as Supabase Edge Function secrets. Webhook processing must verify the provider signature, match the exact transfer reference and amount, and use a unique provider event ID to prevent duplicate activation.
8. Deploy the portal and Edge Functions only after configuring the new Supabase project values and payment provider.

## Payment lifecycle
- Create a pending order server-side with a random, unique `payment_reference`.
- Display a dynamic VietQR payment instruction containing the exact amount and reference.
- A verified bank-feed webhook records an idempotent payment event and marks the matching order paid.
- In the same database transaction, activate the purchased plan. If the user already has an unexpired subscription, append the new period to its latest expiry; otherwise start now.
- Never activate a plan from a browser redirect, screenshot, client-supplied "paid" flag, or unverified webhook.

## Important security notes
- RLS is enabled on all tables. Client write policies are intentionally absent for licenses, orders, payment events, admin roles, and audit logs.
- The first admin is bootstrapped manually in SQL Editor; do not expose an admin self-registration endpoint.
- Trial claim uniqueness is enforced by both user ID and normalized email. This prevents deleting/recreating an account with the same email from receiving another trial, provided the claim table is retained.
- Email-only trial limits cannot reliably stop a person from using a different email address. Device fingerprinting is not a substitute for account security and should be treated as a secondary abuse signal, not a definitive identity.
- Add stronger controls before public launch: rate limits, CAPTCHA on sign-up, email verification, session revocation, payment webhook signature verification, and monitoring.
- This migration is an initial foundation, not a production-ready payment integration. Prices, bank provider, webhook signature format, hosting and secrets still need configuration.
