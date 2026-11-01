# AutoTax 3.2.0

Chrome Manifest V3 side-panel extension for invoice lookup and download.

## Package access model

AutoTax 3.2 replaces the legacy customer-facing trial/monthly/yearly display with two independent package families:

- Invoice packages (T100, T200, T500, T1000, T5000): purchased quantities accumulate. Server-side remaining and purchased totals are stored. Successful invoice-file ZIP saves trigger a deduction request. Invoice identity is scoped to account + MST + direction + form/template + series + invoice number.
- MST packages (MST1, MST5, MST10, MST20, MST50): each paid order creates a separate entitlement lot. Validity is configurable in days. An MST package cannot be sold until an administrator configures that validity.
- If both package families exist, the user selects one active mode. The other family remains preserved.
- Package-specific unlock codes are one-time codes tied to a selected package; redemption grants that exact package lot and cannot be repurposed for another package.
- Password changes use Supabase Auth; passwords are not stored by the extension.
- Package price changes and activation state are server-checked and audited. Pending orders retain the price captured at order creation.

## Supabase deployment

On the dedicated Add-on Supabase project, apply migrations in order: 001_addon_license_portal.sql, 002_addon_pricing_and_order_creation.sql, 003_sepay_webhook_processing.sql, 004_admin_payment_details.sql, 004_show_queued_renewals.sql, 005_package_entitlements_v32.sql, 006_package_admin_and_expiry_hardening.sql, 007_mst_capacity_enforcement.sql, 008_order_snapshot_and_expiry_display.sql, 009_initial_entitlement_mode.sql, 010_package_unlock_codes.sql.

Deploy Edge Functions from addon-portal/supabase/functions and configure the required Supabase/SePay secrets. Do not deploy this schema to an unrelated Tendoo project.

## Current implementation caveats

- The package schema and checkout functions are committed but must be deployed before package purchase works.
- Configure the validity of each MST package in Admin before opening it for sale; no arbitrary duration is assumed.
- MST profile capacity is checked server-side at the start of each GDT download job. Assigned MST profiles are retained when capacity expires; access is limited by the active lot capacity.
- Chrome runtime, real payment and GDT download tests have not been executed as part of this repository update.
