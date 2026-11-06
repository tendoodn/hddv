#!/usr/bin/env python3
"""Validate and optionally deploy Vietnamese AutoTax Auth emails to Supabase.

Uses the Supabase Management API only. It never changes SMTP credentials,
site URL, allowed redirect URLs, user accounts, or security-notification toggles.
Usage:
  python3 auth/email-templates/deploy_templates.py --check
  SUPABASE_ACCESS_TOKEN=... python3 auth/email-templates/deploy_templates.py --apply
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
EXPECTED = {
    "confirmation", "invite", "magic_link", "email_change",
    "reauthentication", "recovery", "password_changed_notification",
    "email_changed_notification", "phone_changed_notification",
    "identity_linked_notification", "identity_unlinked_notification",
    "mfa_factor_enrolled_notification", "mfa_factor_unenrolled_notification",
}
CTA = {"confirmation", "invite", "magic_link", "email_change", "recovery"}
REQUIRED = {
    "email_change": "{{ .NewEmail }}",
    "reauthentication": "{{ .Token }}",
    "email_changed_notification": "{{ .OldEmail }}",
    "phone_changed_notification": "{{ .OldPhone }}",
    "identity_linked_notification": "{{ .Provider }}",
    "identity_unlinked_notification": "{{ .Provider }}",
    "mfa_factor_enrolled_notification": "{{ .FactorType }}",
    "mfa_factor_unenrolled_notification": "{{ .FactorType }}",
}


def make_payload() -> tuple[str, dict[str, str]]:
    manifest = json.loads((HERE / "manifest.vi.json").read_text(encoding="utf-8"))
    ref = manifest.get("project_ref")
    if ref != "ucqqjdsoyvvaxswzbhaw":
        raise ValueError("Project reference differs from the approved AutoTax project")
    specs = manifest.get("templates", {})
    if set(specs) != EXPECTED:
        raise ValueError("Expected exactly 13 supported Supabase Auth template types")
    payload = {}
    for kind, spec in specs.items():
        filename = spec["file"]
        if Path(filename).name != filename or not filename.endswith(".html"):
            raise ValueError("Unsafe or missing template file for " + kind)
        subject = spec["subject"].strip()
        if not subject or len(subject) > 180 or any(c in subject for c in "\r\n"):
            raise ValueError("Invalid email subject for " + kind)
        html = (HERE / filename).read_text(encoding="utf-8")
        if not html.startswith("<!doctype html>") or 'lang="vi"' not in html:
            raise ValueError("Template is not a complete Vietnamese HTML document: " + filename)
        if re.search(r"<script\b|on(?:load|error|click)\s*=|<iframe\b|<form\b", html, re.I):
            raise ValueError("Executable HTML is not allowed in " + filename)
        if kind in CTA and html.count("{{ .ConfirmationURL }}") != 1:
            raise ValueError("Missing exactly one Supabase verification link in " + filename)
        if kind not in CTA and "{{ .ConfirmationURL }}" in html:
            raise ValueError("Unexpected verification link in " + filename)
        needed = REQUIRED.get(kind)
        if needed and needed not in html:
            raise ValueError("Missing essential Supabase variable " + needed + " in " + filename)
        if "lienhe@tracuuhoadon.top" not in html or "AUTOTAX" not in html:
            raise ValueError("Missing AutoTax sender identity in " + filename)
        payload["mailer_subjects_" + kind] = subject
        payload["mailer_templates_" + kind + "_content"] = html
    return ref, payload


def api_request(ref: str, token: str, method: str, payload=None) -> dict:
    endpoint = "https://api.supabase.com/v1/projects/" + ref + "/config/auth"
    headers = {"Authorization": "Bearer " + token, "Accept": "application/json"}
    if payload is not None:
        headers["Content-Type"] = "application/json"
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8") if payload is not None else None
    request = urllib.request.Request(endpoint, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=45) as response:
            result = response.read()
        return json.loads(result) if result else {}
    except urllib.error.HTTPError as exc:
        # Never print the body: it could contain current private Auth settings.
        raise RuntimeError("Supabase Management API request failed (HTTP " + str(exc.code) + ")") from None


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--check", action="store_true")
    mode.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    ref, payload = make_payload()
    print("Validated:", len(payload) // 2, "Vietnamese Supabase Auth templates,",
          len(payload), "subject/content configuration keys.")
    if args.check:
        return 0
    token = os.environ.get("SUPABASE_ACCESS_TOKEN", "").strip()
    if not token:
        print("NOT DEPLOYED: SUPABASE_ACCESS_TOKEN is absent. Set a repo Actions secret "
              "with auth_config_write/project_admin_write permissions; then run workflow.")
        return 2
    before = api_request(ref, token, "GET")
    changed = {key: value for key, value in payload.items() if before.get(key) != value}
    if not changed:
        print("LIVE VERIFIED: all 13 templates and subjects already match Supabase.")
        return 0
    api_request(ref, token, "PATCH", changed)
    after = api_request(ref, token, "GET")
    mismatch = [key for key, value in payload.items() if after.get(key) != value]
    if mismatch:
        print("Deployment not fully verified; mismatched fields:", len(mismatch))
        return 1
    print("LIVE VERIFIED: updated", len(changed), "fields across 13 Auth templates.")
    print("Preserved SMTP credentials, project URLs, account settings and notification switches.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (ValueError, RuntimeError, OSError, KeyError, json.JSONDecodeError) as exc:
        print("Template validation/deployment error:", str(exc))
        sys.exit(1)
