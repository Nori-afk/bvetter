"""Logging in, and reusing a login across tests.

A real UI login is exercised on purpose (that IS TC-PO-F02 / TC-VT-F01 /
TC-AD-F01). Once per role per session it is done through the browser, and the
resulting localStorage payload is cached so the other ~40 tests can adopt the
session in a few milliseconds instead of re-typing credentials 40 times.

Session identity itself still lives server-side in user_sessions - injecting
localStorage only hands the browser back a token it legitimately obtained.
"""

from __future__ import annotations

import time

from selenium.common.exceptions import TimeoutException

from . import config, db, pages
from .helpers import (
    By,
    click,
    dismiss_overlays,
    is_displayed,
    type_into,
    wait,
    wait_for_js,
)

# The three keys public/js/login.js writes on a successful login.
SESSION_KEYS = ("vbetter_session", "bvetter_user", "bvetter_token")

# A page with no role guard at all, used purely as a same-origin place to
# stand while writing localStorage.
NEUTRAL_PAGE = pages.url("public/pages/privacy-policy.html")

EMAIL = (By.ID, "loginEmail")
PASSWORD = (By.ID, "loginPassword")
LOGIN_BTN = (By.CSS_SELECTOR, "#credsStep .btn-login")
OTP_INPUT = (By.ID, "loginOtp")
OTP_BTN = (By.CSS_SELECTOR, "#otpStep .btn-login")
NOTICE_MODAL = (By.ID, "noticeModal")
NOTICE_TEXT = (By.ID, "noticeMessage")
NOTICE_OK = (By.CSS_SELECTOR, "#noticeModal .notice-ok-btn")


class LoginFailed(AssertionError):
    pass


# ---------------------------------------------------------------------------
# primitives
# ---------------------------------------------------------------------------


def notice_message(driver) -> str | None:
    """The text of the login page's own error modal, if it is showing."""
    if not is_displayed(driver, NOTICE_MODAL):
        # The modal is toggled with a class, not a style, so check that too.
        showing = driver.execute_script(
            "const m = document.getElementById('noticeModal');"
            "return m ? m.classList.contains('open') : false;"
        )
        if not showing:
            return None
    text = driver.find_elements(*NOTICE_TEXT)
    return text[0].text.strip() if text else None


def dismiss_notice(driver) -> None:
    if notice_message(driver):
        click(driver, NOTICE_OK)
        time.sleep(0.2)


def submit_credentials(driver, email: str, password: str) -> None:
    type_into(driver, EMAIL, email)
    type_into(driver, PASSWORD, password)
    click(driver, LOGIN_BTN)


def _await_outcome(driver, timeout: float = 60, ignore_otp: bool = False) -> str:
    """Waits for the login POST to resolve into one of three visible outcomes.

    The timeout is generous on purpose: an admin login issues a 2FA code, and
    the code is emailed INSIDE the request (~3.5s per send against Gmail SMTP,
    and the same endpoint may be sending staff notifications). Until that is
    moved off the request path, a login can legitimately take many seconds and a
    tight timeout here just produces a flaky suite blaming the wrong thing.

    `ignore_otp` matters once a code has already been submitted: the OTP step
    stays on screen until the redirect fires, so without this the very first
    poll would report "otp" again and the caller would conclude the code was
    rejected while the request was still in flight.
    """
    end = time.time() + timeout
    while time.time() < end:
        if driver.execute_script("return !!localStorage.getItem('bvetter_token');"):
            return "session"
        if notice_message(driver):
            return "notice"
        if not ignore_otp and driver.execute_script(
            "const s = document.getElementById('otpStep');"
            "return !!s && s.style.display !== 'none';"
        ):
            return "otp"
        time.sleep(0.15)
    return "timeout"


# ---------------------------------------------------------------------------
# per-role UI logins
# ---------------------------------------------------------------------------


def ui_login(driver, email: str, password: str, login_page: str = pages.LOGIN,
             expect_url_fragment: str | None = None, allow_otp: bool = True) -> str:
    """Full browser login. Returns the outcome: 'session' | 'otp' | 'notice'."""
    driver.get(login_page)
    wait_for_js(driver, "document.readyState === 'complete'")
    submit_credentials(driver, email, password)

    outcome = _await_outcome(driver)

    if outcome == "otp" and allow_otp:
        _complete_otp(driver, email)
        outcome = _await_outcome(driver, ignore_otp=True)

    if outcome == "session" and expect_url_fragment:
        try:
            wait(driver, 20).until(lambda d: expect_url_fragment in d.current_url)
        except TimeoutException as exc:
            raise LoginFailed(
                f"Logged in but never landed on {expect_url_fragment}; "
                f"currently at {driver.current_url}"
            ) from exc
    return outcome


def _complete_otp(driver, email: str) -> None:
    """Reads the 6-digit code out of login_otp_codes and submits it.

    The harness is standing in for the mailbox here - see support/dbq.php.
    """
    code = None
    for _ in range(20):
        code = db.login_otp(email)
        if code:
            break
        time.sleep(0.4)
    if not code:
        raise LoginFailed(
            f"No live OTP row for {email}. Two-factor is on for admin accounts "
            "(security_settings.two_factor_enabled) and the code could not be read."
        )
    type_into(driver, OTP_INPUT, code)
    click(driver, OTP_BTN)


def login_owner(driver, email: str | None = None, password: str | None = None) -> str:
    return ui_login(
        driver,
        email or config.OWNER_EMAIL,
        password or config.OWNER_PASSWORD,
        pages.LOGIN,
        expect_url_fragment="landing.html",
    )


def login_vet(driver, email: str | None = None, password: str | None = None) -> str:
    return ui_login(
        driver,
        email or config.VET_EMAIL,
        password or config.VET_PASSWORD,
        pages.LOGIN,
        expect_url_fragment="/vet/html/index.html",
    )


def login_admin(driver, email: str | None = None, password: str | None = None) -> str:
    """Admin logins go through the unlinked ops page and always face email 2FA.

    If the OTP email itself fails to send the endpoint answers 500 - but the
    code row was already written before the send was attempted, so an
    immediate retry hits the 60-second resend throttle, is answered with
    requires_2fa, and the flow continues. That retry is why this is not just
    a call to ui_login().
    """
    email = email or config.ADMIN_EMAIL
    password = password or config.ADMIN_PASSWORD

    driver.get(pages.ADMIN_LOGIN)
    wait_for_js(driver, "document.readyState === 'complete'")
    submit_credentials(driver, email, password)
    outcome = _await_outcome(driver)

    if outcome == "notice":
        message = notice_message(driver) or ""
        if "verification code" in message.lower():
            dismiss_notice(driver)
            click(driver, LOGIN_BTN)
            outcome = _await_outcome(driver)
        else:
            return "notice"

    if outcome == "otp":
        _complete_otp(driver, email)
        outcome = _await_outcome(driver, ignore_otp=True)

    if outcome == "session":
        wait(driver, 20).until(lambda d: "/admin/pages/index.html" in d.current_url)
    return outcome


# ---------------------------------------------------------------------------
# caching a login and re-applying it
# ---------------------------------------------------------------------------


def capture_session(driver) -> dict:
    return {
        key: driver.execute_script(f"return localStorage.getItem({key!r});")
        for key in SESSION_KEYS
    }


def restore_session(driver, session: dict, goto: str | None = None) -> None:
    """Puts a captured login back into this browser and optionally navigates."""
    if driver.current_url.split("#")[0].rstrip("/") in ("", "data:,"):
        driver.get(NEUTRAL_PAGE)
    elif not driver.current_url.startswith(config.BASE_URL):
        driver.get(NEUTRAL_PAGE)

    for key, value in session.items():
        if value is None:
            driver.execute_script(f"localStorage.removeItem({key!r});")
        else:
            driver.execute_script("localStorage.setItem(arguments[0], arguments[1]);", key, value)

    if goto:
        driver.get(goto)


def clear_session(driver) -> None:
    if not driver.current_url.startswith(config.BASE_URL):
        driver.get(NEUTRAL_PAGE)
    driver.execute_script("localStorage.clear(); sessionStorage.clear();")


def token_of(session: dict) -> str | None:
    return session.get("bvetter_token")


def session_is_live(driver, session: dict) -> bool:
    """Asks the server whether this cached token is still valid.

    The idle window is 10 minutes by default and a long suite can outrun it,
    so cached sessions are re-validated rather than assumed.
    """
    token = token_of(session)
    if not token:
        return False
    if not driver.current_url.startswith(config.BASE_URL):
        driver.get(NEUTRAL_PAGE)
    driver.set_script_timeout(20)
    result = driver.execute_async_script(
        """
        const [url, token, done] = arguments;
        const body = new FormData();
        body.append('action', 'check');
        body.append('active', '1');
        fetch(url, {method: 'POST', headers: {'Authorization': 'Bearer ' + token}, body})
            .then(r => r.json()).then(j => done(!!j.valid)).catch(() => done(false));
        """,
        pages.API_SESSION,
        token,
    )
    return bool(result)


def logout_via_ui(driver) -> None:
    """Uses the app's own logout, including its confirm modal."""
    driver.execute_script("if (window.logout) { window.logout(); }")
    try:
        click(driver, (By.CSS_SELECTOR, "#vbConfirmOverlay .vb-confirm-yes"), timeout=5)
    except TimeoutException:
        pass
    wait(driver, 15).until(lambda d: "login.html" in d.current_url or "ops-" in d.current_url)


def prepare_page(driver, url: str, session: dict | None = None) -> None:
    """Adopt `session` (if any) and open `url` with overlays out of the way."""
    if session:
        restore_session(driver, session)
    driver.get(url)
    wait_for_js(driver, "document.readyState === 'complete'")
    dismiss_overlays(driver)
