# AutoTax 3.2.1 — source release candidate

Chrome Manifest V3 side-panel extension for invoice lookup and download.

## Package access model

AutoTax 3.2 replaces the legacy customer-facing trial/monthly/yearly display with two independent package families:

- Invoice packages (T100, T200, T500, T1000, T5000): purchased quantities accumulate. Server-side remaining and purchased totals are stored. Successful invoice exports (Excel or invoice-file ZIP containing XML/HTML/PDF) trigger a deduction request. The server deduplicates by account + MST + direction + form/template + series + invoice number, so exporting the same invoice again in another format does not consume another quota unit. Invoice identity is scoped to account + MST + direction + form/template + series + invoice number.
- MST packages (MST1, MST5, MST10, MST20, MST50): each paid order creates a separate entitlement lot. Validity is configurable in days. An MST package cannot be sold until an administrator configures that validity.
- If both package families exist, the user selects one active mode. The other family remains preserved.
- Package-specific unlock codes are one-time codes tied to a selected package; redemption grants that exact package lot and cannot be repurposed for another package.
- Password changes use Supabase Auth; passwords are not stored by the extension.
- Package price changes and activation state are server-checked and audited. Pending orders retain the price captured at order creation.

## Supabase deployment

Production currently retains the old licensing schema. **Do not run historical migrations or the destructive draft on production.** The V3.2 source set now includes migrations 001–018; a safe, verified migration/reset procedure is not yet released. Preserve auth.users and addon_admins. See addon-portal/README.md and addon-portal/supabase/BUILD_STATUS_V32.md.

Deploy Edge Functions from addon-portal/supabase/functions and configure the required Supabase/SePay secrets. Do not deploy this schema to an unrelated Tendoo project.

## Current implementation caveats

- The package schema and checkout functions are committed but must be deployed before package purchase works.
- Configure the validity of each MST package in Admin before opening it for sale; no arbitrary duration is assumed.
- MST profile capacity is checked server-side at the start of each GDT download job. Assigned MST profiles are retained when capacity expires; access is limited by the active lot capacity.
- Invoice-mode jobs must deploy migration 011 first. The extension claims quota **before** processing the returned invoice list; previously charged invoice identities are allowed without another deduction, even if the package has zero remaining. Claims are serialized per account to prevent concurrent overspending. Each new invoice consumes one unit once, regardless of exported file format. A failed export after the claim does not automatically refund a unit; admin reconciliation is required if a refund policy is desired.\n- Chrome runtime, real payment and GDT download tests have not been executed as part of this repository update.

## Shared V3.2 pages

- Customer portal: `docs/index.html` + `docs/customer.js`.
- Admin: `docs/admin.html` + `docs/admin-mst.js`.
- Extension: `autotax/src/sidepanel/index.html` + `autotax/src/license/license.js`.
- These clients use the same Supabase project and server RPCs; GitHub does not hold customer data. The installed Chrome Extension must be repackaged/published or reloaded after source updates.
- A one-time MST trial is bound to both email and MST; once registered, that history is not erased by unlink. Paid packages are not blocked by an MST used in another account's trial.
- The extension submits only invoice identity fields (including MST and invoice number) to Supabase for quota deduplication; full XML/PDF/Excel files are generated and saved on the user's device.

## Extension 3.2.1 build

GitHub Actions `AutoTax V3.2 sync checks` produces a candidate ZIP only after JavaScript/RPC tests and positive plus negative PostgreSQL upgrade tests pass. This artifact is for review; it is **not** automatically published to Chrome Web Store. Production licensing will become functional only after the existing Supabase instance is migrated safely. See `addon-portal/supabase/DEPLOY_V32_RUNBOOK.md`.
