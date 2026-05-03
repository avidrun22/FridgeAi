#!/usr/bin/env python3
"""
Generate the 6-month JWT secret that Supabase asks for when you configure
the Apple OAuth provider (Path B in docs/apple-sign-in-web-setup.md).

Usage:
    pip install pyjwt cryptography --break-system-packages
    python scripts/apple_sign_in_jwt.py \\
        --team-id   XYZ987WVU6 \\
        --key-id    ABC1234DEF \\
        --client-id com.ok2eat.app.web \\
        --p8-path   ~/Downloads/AuthKey_ABC1234DEF.p8

Paste the printed JWT into Supabase → Authentication → Providers → Apple
→ Secret Key. The token is valid for 6 months from generation; rotate
before it expires.
"""

import argparse
import time
from pathlib import Path

import jwt  # PyJWT


def make_apple_secret(team_id: str, key_id: str, client_id: str, p8_path: Path) -> str:
    p8_bytes = p8_path.read_bytes()
    now = int(time.time())
    payload = {
        "iss": team_id,
        "iat": now,
        "exp": now + 60 * 60 * 24 * 30 * 6,  # 6 months
        "aud": "https://appleid.apple.com",
        "sub": client_id,
    }
    headers = {"kid": key_id, "alg": "ES256"}
    return jwt.encode(payload, p8_bytes, algorithm="ES256", headers=headers)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--team-id", required=True, help="Apple Team ID (10 chars).")
    ap.add_argument("--key-id", required=True, help="Apple Key ID for the .p8.")
    ap.add_argument("--client-id", required=True, help="The Services ID you registered (e.g. com.ok2eat.app.web).")
    ap.add_argument("--p8-path", required=True, type=Path, help="Path to the AuthKey_*.p8 file.")
    args = ap.parse_args()

    token = make_apple_secret(args.team_id, args.key_id, args.client_id, args.p8_path.expanduser())
    print(token)


if __name__ == "__main__":
    main()
