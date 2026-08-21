"""Thin Python wrapper around support/dbq.php.

The suite reads the database through the app's own PDO connection rather than
a second Python MySQL driver: credentials then live in exactly one place
(api/config/connection.php + .env), and a test run cannot drift from what the
application itself is talking to.
"""

from __future__ import annotations

import json
import os
import subprocess

from . import config

_DBQ = os.path.join(os.path.dirname(os.path.abspath(__file__)), "dbq.php")


class DbHelperError(RuntimeError):
    pass


def query(action: str, *args: str) -> dict:
    """Runs one whitelisted action and returns its decoded JSON payload."""
    cmd = [config.PHP_BIN, _DBQ, action, *[str(a) for a in args]]
    try:
        completed = subprocess.run(
            cmd, capture_output=True, text=True, timeout=30, check=False
        )
    except FileNotFoundError as exc:  # php.exe not where we expected
        raise DbHelperError(
            f"Could not run {config.PHP_BIN}. Set BVETTER_PHP_BIN to your php.exe."
        ) from exc

    raw = (completed.stdout or "").strip()
    if not raw:
        raise DbHelperError(
            f"dbq.php {action} produced no output. stderr: {completed.stderr.strip()}"
        )

    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise DbHelperError(f"dbq.php {action} returned non-JSON: {raw[:300]}") from exc

    if not payload.get("ok"):
        raise DbHelperError(f"dbq.php {action} failed: {payload.get('error')}")
    return payload


# -- convenience wrappers ---------------------------------------------------


def available() -> bool:
    try:
        query("ping")
        return True
    except DbHelperError:
        return False


def user(email: str) -> dict | None:
    return query("user", email)["user"]


def reset_failed_attempts(email: str) -> None:
    query("reset_failed_attempts", email)


def ensure_pending_owner(email: str, password: str) -> int:
    """Creates/refreshes an owner account still awaiting admin verification."""
    return query("ensure_pending_owner", email, password)["user_id"]


def login_otp(email: str) -> str | None:
    return query("login_otp", email)["otp"]


def registration_otp(email: str) -> str | None:
    """The pre-account email OTP the registration form asks for."""
    return query("registration_otp", email)["otp"]


def reset_token(email: str) -> str | None:
    return query("reset_token", email)["token"]


def reseed() -> None:
    """Puts the three test accounts back to their canonical password/status.

    Used after any test that deliberately changes a test account's password
    (TC-PO-F03) so the rest of the run still has working credentials.
    """
    seed = os.path.join(os.path.dirname(os.path.abspath(__file__)), "seed.php")
    completed = subprocess.run(
        [config.PHP_BIN, seed], capture_output=True, text=True, timeout=60, check=False
    )
    if completed.returncode != 0:
        raise DbHelperError(f"seed.php failed: {completed.stderr.strip()}")


def age_session(token: str, minutes: int = 30) -> int:
    return query("age_session", token, minutes)["rows"]


def idle_minutes() -> int:
    return query("idle_minutes")["minutes"]


def latest_appointment(email: str) -> dict | None:
    return query("latest_appointment", email)["appointment"]


def latest_lf_report(email: str) -> dict | None:
    return query("latest_lf_report", email)["report"]


def foreign_lf_report(email: str) -> dict | None:
    return query("foreign_lf_owner", email)["report"]


def any_vacc_event() -> dict | None:
    return query("any_vacc_event")["event"]


def cleanup() -> dict:
    return query("cleanup")["deleted"]
