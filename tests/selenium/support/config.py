"""Runtime configuration for the BVetter Selenium suite.

Every value can be overridden with an environment variable, so the same suite
runs against local XAMPP and against a staging host without editing code:

    set BVETTER_BASE_URL=http://localhost/final-VBETTER/bvetter
    set BVETTER_HEADLESS=0
"""

from __future__ import annotations

import os

# --------------------------------------------------------------------------
# Where the app lives
# --------------------------------------------------------------------------

BASE_URL = os.environ.get(
    "BVETTER_BASE_URL", "http://localhost/final-VBETTER/bvetter"
).rstrip("/")

# php.exe is needed for support/dbq.php (the mailbox/clock stand-in).
PHP_BIN = os.environ.get("BVETTER_PHP_BIN", r"C:\xampp\php\php.exe")


def is_remote(url: str | None = None) -> bool:
    """True when the target is not this machine.

    dbq.php talks to the LOCAL database. Pointed at a remote host, every code
    and token it reads would belong to a different installation - so the tests
    that depend on it have to be skipped rather than quietly asserted against
    the wrong data. Everything that only needs a browser still runs.
    """
    target = (url or BASE_URL).lower()
    return not any(
        marker in target for marker in ("localhost", "127.0.0.1", "::1", "0.0.0.0")
    )

# --------------------------------------------------------------------------
# Test accounts (created by support/seed.php)
# --------------------------------------------------------------------------

OWNER_EMAIL = os.environ.get("BVETTER_OWNER_EMAIL", "selenium.owner@bvetter.test")
VET_EMAIL = os.environ.get("BVETTER_VET_EMAIL", "selenium.vet@bvetter.test")
ADMIN_EMAIL = os.environ.get("BVETTER_ADMIN_EMAIL", "selenium.admin@bvetter.test")
PASSWORD = os.environ.get("BVETTER_PASSWORD", "Qz7#mVr9Tb2!")

# Per-role passwords, for a remote run where the three accounts are real and
# each has its own. Falls back to PASSWORD when unset.
OWNER_PASSWORD = os.environ.get("BVETTER_OWNER_PASSWORD") or PASSWORD
VET_PASSWORD = os.environ.get("BVETTER_VET_PASSWORD") or PASSWORD
ADMIN_PASSWORD = os.environ.get("BVETTER_ADMIN_PASSWORD") or PASSWORD

#: The seeder's addresses. Against a remote host these will not exist unless
#: someone deliberately created them, so their presence is how the suite tells
#: "credentials were supplied" from "nobody configured this run".
SEEDED_EMAILS = {
    "selenium.owner@bvetter.test",
    "selenium.vet@bvetter.test",
    "selenium.admin@bvetter.test",
}

# Deliberately never registered. Used for the invalid-credentials cases so the
# 3-strike lockout in api/config/login_security.php has no account to block.
UNKNOWN_EMAIL = "no.such.person@bvetter.test"
WRONG_PASSWORD = "Wr0ng!Password#42"

# --------------------------------------------------------------------------
# Browser
# --------------------------------------------------------------------------

HEADLESS = os.environ.get("BVETTER_HEADLESS", "1") not in ("0", "false", "False")
BROWSER = os.environ.get("BVETTER_BROWSER", "chrome")
WINDOW_SIZE = os.environ.get("BVETTER_WINDOW", "1440,960")
IMPLICIT_WAIT = 0  # explicit waits only - implicit waits interact badly with them
DEFAULT_TIMEOUT = float(os.environ.get("BVETTER_TIMEOUT", "20"))

# --------------------------------------------------------------------------
# Performance budgets, straight from the test-case document
# --------------------------------------------------------------------------

BUDGET_STANDARD = float(os.environ.get("BVETTER_BUDGET_STANDARD", "3.0"))  # seconds
BUDGET_ANALYTICS = float(os.environ.get("BVETTER_BUDGET_ANALYTICS", "5.0"))  # seconds

# --------------------------------------------------------------------------
# Data tagging
# --------------------------------------------------------------------------

# Everything the suite writes carries this marker so support/dbq.php cleanup
# can find it and nothing else.
SEL_TAG = "[SELENIUM]"

REPORT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "reports")
SHOT_DIR = os.path.join(REPORT_DIR, "screenshots")
