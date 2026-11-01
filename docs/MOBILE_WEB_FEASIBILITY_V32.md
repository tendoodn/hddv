# AutoTax Web Mobile – technical feasibility and delivery scope

Status: design proposal only. **No mobile GDT lookup has been implemented or verified.**
Do not advertise this as a working GDT integration.

## Goal

Mobile-first independent web app, e.g. \`/hddv/mobile/\`, for Android/iPhone
users without desktop Chrome. Same Supabase Auth, package catalog, MST lots,
invoice quota, admin permissions and already-charged invoice fingerprints.

## Existing extension pieces to reuse

| Component | Existing source | Mobile adaptation |
| --- | --- | --- |
| Package login, trial and entitlements | \`src/license/license.js\` | Web Supabase SDK; use existing RLS/RPCs |
| Invoice identity and single-charge quota | \`src/content/content.js\` + \`addon_claim_invoice_quota\` | Same server RPC and identity (MST, direction, template, series, number) |
| Search by date, invoice types, monthly and MTT batches | \`src/content/hddt-api.js\` | Extract shared pure date/normalization code; **MTT max 10 calendar days per batch** |
| Excel, PDF, XML, ZIP | \`src/content/{xlsx,pdf,report,zip}.js\` | Adapt downloads to mobile browser Blob/stream, avoid Chrome downloads API |
| CAPTCHA and GDT session | content script in authenticated \`hoadondientu.gdt.gov.vn\` tab | New permission-aware transport/auth flow; cannot reuse extension tab context directly |

## Critical GDT integration constraint

A normal website cannot call \`chrome.tabs\`, \`chrome.sidePanel\`, or
\`chrome.downloads\`, inject content scripts into GDT, or automatically access
the user's authenticated GDT browser cookies. Web cross-origin requests need
an authorized API/compatible CORS origin or a server-side integration allowed
by the upstream provider. The public government guidance also describes
CAPTCHA for public lookup and separate authenticated search.

Do not use unsupported cookie forwarding, bypass CAPTCHA or reverse
engineering access controls. Do not ask for, store or log GDT account
passwords, signed tokens, OTPs or captured CAPTCHA data in Supabase.

## Phased plan

1. **Mobile portal:** responsive login, rights dashboard, MST selection,
   package purchase, status, history, usage mode. Reuse existing Supabase RPCs.
2. **Search transport proof of concept:** validate a permitted official GDT
   integration and mobile-friendly session/CAPTCHA input. Explicitly verify
   public vs authenticated search capability, buyer vs seller visibility,
   and local regulations/terms. If automated lookup is unsupported, offer
   manual lookup on the official website and local XML import as a constrained
   alternative; do not claim feature parity.
3. **Single-invoice retrieval:** invoice number, form, series, date, MST,
   status and original XML where provider supports it. No bulk claims before
   data has been validated and is ready to deliver.
4. **Bulk export:** separate purchase/sales Excel, signed XML/HTML/PDF ZIP,
   10-day MTT segmentation, rate limits, progress/retry, quota atomicity.
5. **Security and release:** non-admin RLS, expiry/session timeouts, encryption
   in transit, no persistent GDT credentials on backend, anti-duplicate quota
   tests shared with CRX, mobile browser tests.

## Definition of done

- Verified end-to-end GDT test with explicit, legitimate user authorization,
  including CAPTCHA flow on iOS Safari and Android Chrome.
- Same invoice charges only once across browser and CRX.
- No unauthorized cross-account invoice access and no stored GDT passwords.
- Compliant 10-day MTT batches and separate normal invoice flow.
- Practical formats/downloads tested on both phone platforms.

## CRX prerequisite

CRX v3.2.1 can be built automatically from the \`autotax/\` folder.
Set \`AUTOTAX_CRX_PRIVATE_KEY_B64\` in Actions secrets for stable IDs and
updates. Without the persistent private key the CRX is **developer test only**
because a new key changes the extension ID; ZIP remains suitable for testing
via Chrome Load unpacked on desktop.
