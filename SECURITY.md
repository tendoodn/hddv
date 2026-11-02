# AutoTax V1.1 — source access, releases and security

AutoTax is developed and published from the `tendoodn/hddv` source repository.

## Public read versus write access

- Public users can view, clone and fork a public repository. There is no GitHub setting that lets them read source but prevents them from creating and editing independent copies. Branch protections **only protect this repository**.
- Only accounts granted write or admin access can change this repository; the owner should review collaborators in **Settings → Collaborators**.
- `.github/CODEOWNERS` declares `@tendoodn` as reviewer. Enforcement requires a protected-branch ruleset: enable required pull requests, require code-owner approval, disallow force push/deletions and require passing AutoTax validation checks. Do not assume CODEOWNERS alone enforces access.
- Protect both `main` and the Pages publication branch `feature/addon-license-portal`. Coordinate the icon synchronization workflow because it currently pushes generated assets to both branches.
- Keep API service-role keys, payment secrets, signing keys, personal identifiers and PDF source credentials **outside** public GitHub, ZIP and CRX packages. Never add them as committed variables.

## Release retention

1. Build, validate and upload the latest ZIP and (if available) a consistently signed CRX to Google Drive: `Autotax` folder.
2. Verify the files on Drive are nonempty and correspond to the intended manifest version.
3. Keep `AutoTax_v3.3.6_Chrome.zip` unchanged and only the newest installable ZIP/CRX. Remove previous V1.1 release packages **after** confirming the replacements.
4. Never commit ZIP/CRX/private signing keys to source. GitHub Actions packages are **temporary artifacts**, not repository files, and now expire after one day. Legacy artifacts uploaded before the new policy may remain until their original expiry unless deleted by a repository administrator.
5. Preserve the CRX private signing key securely under the owner's control to keep extension ID stable across releases. Do not upload it to the publicly shared Drive folder.

## Legal notice

Publicly viewing source code does not authorize rewriting other people's license terms. The project includes separately licensed dependencies and fonts; preserve their original notices.

## Coordinated vulnerability disclosure

Contact the repository owner privately for security reports. Do not include customer invoices, passwords, taxpayer identifiers or API keys in public issues.
