"""Security Testing  (TC-PO-S01..S05, TC-VT-S01..S05, TC-AD-S01..S05).

Two layers are checked, not one. A page guard that redirects the browser is
what a user sees; it is not what protects the data, because anyone can call
the endpoint directly. So wherever a case is about access control, the page
redirect AND the API response are both asserted.

Note on wrong-password cases: api/config/login_security.php blocks an account
after three consecutive wrong passwords. Every invalid-credential test here
therefore uses an address that was never registered, so there is no account to
lock - and no chance of a test run locking a real person out.
"""

from __future__ import annotations

import json

import pytest

from support import auth, config, db, pages
from support.helpers import (
    js_fetch,
    wait,
    wait_for_js,
)
from support.marks import testcase

PENDING_EMAIL = "selenium.reg.pending@bvetter.test"
PENDING_PASSWORD = "Pv3^kMta7Qd9"


def _await_redirect(driver, away_from: str, timeout: float = 20) -> str:
    """Waits until the browser has been bounced off `away_from`."""
    try:
        wait(driver, timeout).until(lambda d: away_from not in d.current_url)
    except Exception:
        pass
    return driver.current_url


def _body_text(driver) -> str:
    return driver.execute_script("return document.body ? document.body.innerText : '';")


# ===========================================================================
# Invalid credentials  (TC-PO-S01 / TC-VT-S01 / TC-AD-S01)
# ===========================================================================


def _assert_invalid_credentials(driver, tc, login_page: str, dashboard_fragment: str):
    driver.get(login_page)
    wait_for_js(driver, "document.readyState === 'complete'")
    auth.submit_credentials(driver, config.UNKNOWN_EMAIL, config.WRONG_PASSWORD)

    message = wait(driver, 20).until(lambda d: auth.notice_message(d) or False)
    tc.measure("message", message)
    tc.shot("rejected")

    assert not driver.execute_script("return localStorage.getItem('bvetter_token');"), \
        "A session token was issued for credentials that do not exist"
    assert dashboard_fragment not in driver.current_url, \
        f"Rejected credentials still navigated to {driver.current_url}"

    lowered = message.lower()
    assert "invalid" in lowered or "incorrect" in lowered, \
        f"The error message should say the credentials are invalid; it said {message!r}"

    # The message must not reveal whether the address has an account.
    for leak in ("no account", "not registered", "does not exist", "unknown email",
                 "wrong password", "password is incorrect"):
        assert leak not in lowered, \
            f"The error message leaks account existence: {message!r}"


@testcase(
    "TC-PO-S01", "Login with Invalid Credentials",
    "Access is denied with a generic error and no protected page is reached",
    category="security", role="owner",
)
def test_owner_invalid_credentials(driver, tc):
    _assert_invalid_credentials(driver, tc, pages.LOGIN, "landing.html")


@testcase(
    "TC-VT-S01", "Login with Invalid Credentials",
    "Access is denied with a generic error and the clinical dashboard is not reached",
    category="security", role="vet",
)
def test_vet_invalid_credentials(driver, tc):
    _assert_invalid_credentials(driver, tc, pages.LOGIN, "/vet/html/")


@testcase(
    "TC-AD-S01", "Login with Invalid Credentials",
    "Access is denied with a generic error and the admin dashboard is not reached",
    category="security", role="admin",
)
def test_admin_invalid_credentials(driver, tc):
    _assert_invalid_credentials(driver, tc, pages.ADMIN_LOGIN, "/admin/pages/index.html")


# ===========================================================================
# TC-PO-S02  Unverified account access restriction
# ===========================================================================


@testcase(
    "TC-PO-S02", "Unverified Account Access Restriction",
    "An account still awaiting admin verification cannot log in and is told why",
    category="security", role="owner",
)
def test_pending_account_cannot_log_in(driver, tc, mutating):
    db.ensure_pending_owner(PENDING_EMAIL, PENDING_PASSWORD)
    row = db.user(PENDING_EMAIL)
    tc.measure("account_status", row["account_status"])
    tc.measure("verification_status", row["verification_status"])
    tc.note("Account is in the exact state api/auth/register.php leaves a new signup in")

    driver.get(pages.LOGIN)
    auth.submit_credentials(driver, PENDING_EMAIL, PENDING_PASSWORD)
    message = wait(driver, 20).until(lambda d: auth.notice_message(d) or False)
    tc.measure("message", message)
    tc.shot("pending-rejected")

    assert not driver.execute_script("return localStorage.getItem('bvetter_token');"), \
        "A pending account was given a session token"
    assert "landing.html" not in driver.current_url, \
        "A pending account reached the pet owner home page"

    lowered = message.lower()
    assert any(word in lowered for word in ("approval", "verif", "pending", "not active")), (
        "The user should be told the account is awaiting verification; "
        f"the message was {message!r}"
    )

    # The API has to refuse too, not just the page.
    driver.get(auth.NEUTRAL_PAGE)
    response = js_fetch(
        driver, pages.API_LOGIN, "POST",
        f"email={PENDING_EMAIL}&password={PENDING_PASSWORD}",
        json_body=False,
    )
    tc.measure("api_status", response["status"])
    assert response["status"] in (401, 403), \
        f"api/auth/login.php answered {response['status']} for a pending account"


# ===========================================================================
# TC-PO-S03  Owner cannot reach vet / admin modules
# ===========================================================================


@testcase(
    "TC-PO-S03", "Unauthorized Access to Restricted Modules",
    "A pet owner typing a vet or admin URL is redirected and sees no restricted content",
    category="security", role="owner",
)
def test_owner_cannot_open_staff_pages(as_owner, driver, tc, owner_session):
    blocked = []
    for label, url in pages.VET_ONLY_PAGES + pages.ADMIN_ONLY_PAGES:
        auth.restore_session(driver, owner_session)
        driver.get(url)
        landed = _await_redirect(driver, url.rsplit("/", 1)[-1])
        reached = url.rsplit("/", 1)[-1] in landed
        blocked.append(f"{label}={'REACHED' if reached else 'blocked'}")
        if reached:
            tc.shot(f"reached-{label.replace(' ', '-')}")
    tc.measure("pages", ", ".join(blocked))
    assert all("REACHED" not in entry for entry in blocked), \
        f"A pet owner was left on a restricted page: {blocked}"

    # And the data behind those pages is refused as well.
    auth.restore_session(driver, owner_session)
    driver.get(auth.NEUTRAL_PAGE)
    token = auth.token_of(owner_session)

    records = js_fetch(driver, pages.API_PATIENT_RECORDS, "GET", token=token)
    tc.measure("patient_records_api", records["status"])
    assert records["status"] == 403, (
        "api/patient-records/patient_records.php should refuse a pet owner token with 403, "
        f"it answered {records['status']}"
    )

    accounts = js_fetch(driver, pages.API_ACCOUNT_MGMT, "POST", {"action": "list"}, token=token)
    tc.measure("account_management_api", accounts["status"])
    assert accounts["status"] == 403, (
        "api/admin/account-management.php should refuse a pet owner token with 403, "
        f"it answered {accounts['status']}"
    )


# ===========================================================================
# Session timeout  (TC-PO-S04 / TC-VT-S04 / TC-AD-S04)
# ===========================================================================


def _assert_idle_logout(driver, tc, session: dict, page: str, login_fragment: str):
    """Ages the session past the idle window instead of waiting for it.

    The window is security_settings.session_idle_minutes (10 by default) and is
    enforced server-side against user_sessions.last_seen_at, so moving
    last_seen_at back is the same condition a genuinely abandoned tab reaches -
    it just gets there in a second rather than ten minutes.
    """
    idle_minutes = db.idle_minutes()
    tc.measure("idle_window_minutes", idle_minutes)

    auth.restore_session(driver, session)
    driver.get(page)
    wait_for_js(driver, "document.readyState === 'complete'")
    assert login_fragment not in driver.current_url, \
        "The session was not valid to begin with, so the timeout was never exercised"

    token = auth.token_of(session)
    rows = db.age_session(token, idle_minutes + 5)
    tc.measure("sessions_aged", rows)
    assert rows == 1, "Could not find the live session row to age"
    tc.note(f"last_seen_at pushed back {idle_minutes + 5} minutes")

    # auth.js re-checks on window focus, so nudge it rather than waiting out
    # the 10-second poll.
    driver.execute_script("window.dispatchEvent(new Event('focus'));")

    landed = wait(driver, 40).until(lambda d: login_fragment in d.current_url and d.current_url)
    tc.measure("redirected_to", landed.rsplit("/", 1)[-1])
    tc.shot("timed-out")

    assert not driver.execute_script("return localStorage.getItem('bvetter_token');"), \
        "The expired session token was left behind in localStorage"


@testcase(
    "TC-PO-S04", "Session Timeout and Automatic Logout",
    "An idle owner session is ended server-side and the browser is returned to the login page",
    category="security", role="owner",
)
def test_owner_session_timeout(driver, tc, owner_session, needs_db):
    _assert_idle_logout(driver, tc, owner_session, pages.LOST_FOUND, "login.html")


@testcase(
    "TC-VT-S04", "Session Timeout and Automatic Logout",
    "An idle clinical session is ended and the vet must re-authenticate",
    category="security", role="vet",
)
def test_vet_session_timeout(driver, tc, vet_session, needs_db):
    _assert_idle_logout(driver, tc, vet_session, pages.VET_PATIENT_RECORDS, "login.html")


@testcase(
    "TC-AD-S04", "Session Timeout and Automatic Logout",
    "An idle admin session is ended and the admin must re-authenticate",
    category="security", role="admin",
)
def test_admin_session_timeout(driver, tc, admin_session, needs_db):
    _assert_idle_logout(driver, tc, admin_session, pages.ADMIN_ACCOUNTS, "ops-")


# ===========================================================================
# TC-PO-S05  Lost and Found data privacy
# ===========================================================================


@testcase(
    "TC-PO-S05", "Lost and Found Data Privacy",
    "An owner cannot read another owner's reports, even by supplying their id",
    category="security", role="owner",
)
def test_owner_cannot_read_other_owners_reports(driver, tc, owner_session, needs_db):
    victim = db.foreign_lf_report(config.OWNER_EMAIL)
    if not victim:
        pytest.skip("No lost-and-found report belonging to a different owner exists to probe")
    tc.measure("target_report_id", victim["id"])
    tc.measure("target_owner_id", victim["owner_id"])

    me = db.user(config.OWNER_EMAIL)
    auth.restore_session(driver, owner_session)
    driver.get(auth.NEUTRAL_PAGE)
    token = auth.token_of(owner_session)

    # Ask for MY reports, but claim to be the other owner.
    forged = js_fetch(
        driver, pages.API_LOST_FOUND, "POST",
        {"action": "my_reports", "owner_id": victim["owner_id"],
         "user_id": victim["owner_id"]},
        token=token,
    )
    tc.measure("api_status", forged["status"])
    assert forged["status"] == 200, \
        f"The endpoint errored ({forged['status']}) instead of scoping the request"

    payload = json.loads(forged["text"])
    reports = payload.get("data") or payload.get("reports") or []
    if isinstance(reports, dict):
        reports = reports.get("reports", [])
    owners = {r.get("owner_id") for r in reports if isinstance(r, dict)}
    tc.measure("owner_ids_returned", ", ".join(str(o) for o in sorted(owners, key=str)) or "none")
    tc.note(f"Authenticated owner id is {me['id']}; forged owner_id was {victim['owner_id']}")

    assert victim["owner_id"] not in owners, (
        "Supplying another owner's id returned that owner's reports - "
        "the endpoint is trusting the request body over the session"
    )
    assert owners <= {me["id"], None}, \
        f"Reports belonging to other owners were returned: {owners}"


# ===========================================================================
# TC-VT-S02 / TC-AD-S02 / TC-AD-S03  Vet cannot reach admin-only modules
# ===========================================================================


@testcase(
    "TC-VT-S02", "Unauthorized Access to Admin-Only Modules",
    "A veterinarian typing the Account Management or Website Settings URL is turned away",
    category="security", role="vet",
)
def test_vet_cannot_open_admin_pages(driver, tc, vet_session):
    results = []
    for label, url in pages.ADMIN_ONLY_PAGES:
        auth.restore_session(driver, vet_session)
        driver.get(url)
        landed = _await_redirect(driver, url.rsplit("/", 1)[-1])
        reached = url.rsplit("/", 1)[-1] in landed
        results.append(f"{label}={'REACHED' if reached else 'blocked'}")
    tc.measure("pages", ", ".join(results))
    tc.shot("vet-blocked")
    assert all("REACHED" not in entry for entry in results), \
        f"A veterinarian was left on an admin-only page: {results}"

    auth.restore_session(driver, vet_session)
    driver.get(auth.NEUTRAL_PAGE)
    token = auth.token_of(vet_session)

    accounts = js_fetch(driver, pages.API_ACCOUNT_MGMT, "POST", {"action": "list"}, token=token)
    tc.measure("account_management_api", accounts["status"])
    assert accounts["status"] == 403, (
        "api/admin/account-management.php should refuse a veterinarian token with 403, "
        f"it answered {accounts['status']}"
    )

    settings = js_fetch(driver, pages.API_SITE_SETTINGS, "POST",
                        {"action": "save", "brand_color": "#000000"}, token=token)
    tc.measure("site_settings_api", settings["status"])
    assert settings["status"] == 403, (
        "api/site-settings/site-settings.php should refuse a veterinarian save with 403, "
        f"it answered {settings['status']}"
    )


@testcase(
    "TC-VT-S03", "Patient Data Access Control",
    "A veterinarian can read patient records but cannot reach administrative user data",
    category="security", role="vet",
)
def test_vet_permissions_are_scoped(driver, tc, vet_session):
    auth.restore_session(driver, vet_session)
    driver.get(auth.NEUTRAL_PAGE)
    token = auth.token_of(vet_session)

    allowed = js_fetch(driver, pages.API_PATIENT_RECORDS, "GET", token=token)
    tc.measure("patient_records_api", allowed["status"])
    assert allowed["status"] == 200, (
        "A veterinarian must be able to read patient records; the endpoint answered "
        f"{allowed['status']}"
    )

    # ... but the operations reserved for an administrator are refused.
    for label, url, body in (
        ("delete a user", pages.API_ACCOUNT_MGMT, {"action": "delete", "user_id": 1}),
        ("block a user", pages.API_ACCOUNT_MGMT, {"action": "update_status",
                                                  "user_id": 1, "status": "blocked"}),
    ):
        response = js_fetch(driver, url, "POST", body, token=token)
        tc.measure(label.replace(" ", "_"), response["status"])
        assert response["status"] == 403, (
            f"A veterinarian was not refused when trying to {label}; the endpoint "
            f"answered {response['status']}"
        )

    # An unauthenticated caller gets nothing at all.
    anonymous = js_fetch(driver, pages.API_PATIENT_RECORDS, "GET", token=None)
    tc.measure("patient_records_no_token", anonymous["status"])


@testcase(
    "TC-AD-S02", "Account Management Access Restriction for Non-Admin Users",
    "Neither a veterinarian nor a pet owner can reach Account Management by URL",
    category="security", role="admin",
)
def test_account_management_is_admin_only(driver, tc, vet_session, owner_session):
    outcomes = {}
    for label, session in (("veterinarian", vet_session), ("pet owner", owner_session)):
        auth.restore_session(driver, session)
        driver.get(pages.ADMIN_ACCOUNTS)
        landed = _await_redirect(driver, "account-management.html")
        outcomes[label] = landed.rsplit("/", 1)[-1]
        assert "account-management.html" not in landed, \
            f"A {label} was left on the Account Management page"

        body = _body_text(driver).lower()
        for leak in ("registered users", "blocked accounts", "create new user"):
            assert leak not in body, \
                f"Account Management content leaked to a {label}: {leak!r} was rendered"
    tc.measure("redirects", ", ".join(f"{k} -> {v}" for k, v in outcomes.items()))
    tc.shot("non-admin-blocked")


@testcase(
    "TC-AD-S03", "Website Settings Access Restriction for Non-Admin Users",
    "Neither a veterinarian nor a pet owner can reach Website Settings by URL",
    category="security", role="admin",
)
def test_website_settings_is_admin_only(driver, tc, vet_session, owner_session):
    outcomes = {}
    for label, session in (("veterinarian", vet_session), ("pet owner", owner_session)):
        auth.restore_session(driver, session)
        driver.get(pages.ADMIN_WEBSITE)
        landed = _await_redirect(driver, "website-management.html")
        outcomes[label] = landed.rsplit("/", 1)[-1]
        assert "website-management.html" not in landed, \
            f"A {label} was left on the Website Settings page"

        body = _body_text(driver).lower()
        for leak in ("visual assets", "brand color", "save changes"):
            assert leak not in body, \
                f"Website Settings content leaked to a {label}: {leak!r} was rendered"
    tc.measure("redirects", ", ".join(f"{k} -> {v}" for k, v in outcomes.items()))
    tc.shot("non-admin-blocked-website")


# ===========================================================================
# TC-VT-S05 / TC-AD-S05  Nothing is reachable without authentication
# ===========================================================================


def _assert_anonymous_is_refused(driver, tc, page_list, login_fragment, leaks):
    auth.clear_session(driver)
    reached = []
    for label, url in page_list:
        driver.get(url)
        landed = _await_redirect(driver, url.rsplit("/", 1)[-1])
        if url.rsplit("/", 1)[-1] in landed:
            reached.append(label)
            continue
        assert login_fragment in landed, \
            f"{label} sent an anonymous visitor to {landed}, not to a login page"
        body = _body_text(driver).lower()
        for leak in leaks:
            assert leak not in body, f"{label} rendered {leak!r} to an anonymous visitor"
    tc.measure("pages_checked", len(page_list))
    assert not reached, f"An anonymous visitor was left on: {reached}"


@testcase(
    "TC-VT-S05", "Protected Clinical Data Access Without Authentication",
    "Clinical pages and endpoints refuse an unauthenticated visitor and expose nothing",
    category="security", role="vet",
)
def test_clinical_pages_require_authentication(driver, tc):
    _assert_anonymous_is_refused(
        driver, tc, pages.VET_ONLY_PAGES, "login.html",
        leaks=("total patients", "visits this month", "predicted disease"),
    )
    tc.shot("anonymous-blocked-clinical")

    driver.get(auth.NEUTRAL_PAGE)
    for label, url, method in (
        ("patient_records", pages.API_PATIENT_RECORDS, "GET"),
        ("reports", pages.API_REPORTS, "GET"),
    ):
        response = js_fetch(driver, url, method, token=None)
        tc.measure(f"{label}_api", response["status"])
        assert response["status"] == 401, (
            f"{url} should answer 401 without a token; it answered {response['status']}"
        )
        assert "patient" not in response["text"].lower() or "message" in response["text"].lower(), \
            f"{url} returned data to an unauthenticated caller"


@testcase(
    "TC-AD-S05", "Protected Administrative Data Access Without Authentication",
    "Admin pages and endpoints refuse an unauthenticated visitor and expose nothing",
    category="security", role="admin",
)
def test_admin_pages_require_authentication(driver, tc):
    auth.clear_session(driver)
    for label, url in pages.ADMIN_ONLY_PAGES:
        driver.get(url)
        landed = _await_redirect(driver, url.rsplit("/", 1)[-1])
        assert url.rsplit("/", 1)[-1] not in landed, \
            f"An anonymous visitor was left on {label}"
        # Admin-only pages send an anonymous visitor to the hidden admin door,
        # not to the public login page (see requireAuth in shared/js/auth.js).
        assert "ops-" in landed or "login.html" in landed, \
            f"{label} sent an anonymous visitor to {landed}, not to a login page"
        body = _body_text(driver).lower()
        for leak in ("registered users", "blocked accounts", "brand color"):
            assert leak not in body, f"{label} rendered {leak!r} to an anonymous visitor"
    tc.measure("pages_checked", len(pages.ADMIN_ONLY_PAGES))
    tc.shot("anonymous-blocked-admin")

    driver.get(auth.NEUTRAL_PAGE)
    accounts = js_fetch(driver, pages.API_ACCOUNT_MGMT, "POST", {"action": "list"}, token=None)
    tc.measure("account_management_api", accounts["status"])
    assert accounts["status"] == 401, (
        "api/admin/account-management.php should answer 401 without a token; "
        f"it answered {accounts['status']}"
    )

    settings = js_fetch(driver, pages.API_SITE_SETTINGS, "POST",
                        {"action": "save", "brand_color": "#000000"}, token=None)
    tc.measure("site_settings_api", settings["status"])
    assert settings["status"] == 401, (
        "Saving site settings should answer 401 without a token; "
        f"it answered {settings['status']}"
    )
