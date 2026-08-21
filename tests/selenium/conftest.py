"""Fixtures, preflight checks and reporting for the BVetter Selenium suite.

Run everything:            py -m pytest tests/selenium
Watch it happen:           py -m pytest tests/selenium --headed
One category:              py -m pytest tests/selenium -m security
One role:                  py -m pytest tests/selenium -m "vet and functional"
Read-only run:             py -m pytest tests/selenium --no-mutate
"""

from __future__ import annotations

import os
import socket
import sys
import time
import urllib.error
import urllib.request

import pytest
from selenium import webdriver
from selenium.webdriver.chrome.options import Options as ChromeOptions
from selenium.webdriver.edge.options import Options as EdgeOptions

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from support import auth, config, db, pages  # noqa: E402
from support.helpers import (  # noqa: E402
    probe_external_script,
    screenshot,
    unregister_service_workers,
)
from support.report import Reporter  # noqa: E402

_reporter = Reporter()


# ---------------------------------------------------------------------------
# command line
# ---------------------------------------------------------------------------


def pytest_addoption(parser):
    group = parser.getgroup("bvetter")
    group.addoption("--headed", action="store_true",
                    help="Show the browser window instead of running headless.")
    group.addoption("--no-mutate", action="store_true",
                    help="Skip every test that writes to the database.")
    group.addoption("--keep-data", action="store_true",
                    help="Do not delete the [SELENIUM]-tagged rows at the end of the run.")
    group.addoption("--base-url", action="store", default=None,
                    help="Override BVETTER_BASE_URL for this run.")
    group.addoption("--slow", action="store_true",
                    help="Pause briefly between steps - useful with --headed for a demo.")
    group.addoption("--allow-remote-writes", action="store_true",
                    help=("Permit the data-writing tests to run against a REMOTE host. "
                          "Off by default: against bvetter.me those steps create real "
                          "appointments, real lost-and-found reports and real accounts, "
                          "and send real email to real people."))
    group.addoption("--bypass-sw", action="store_true",
                    help=("Unregister the service worker before each page load. Use this "
                          "to test the pages underneath the sw.js/CSP defect that stops "
                          "every CDN library from loading."))
    group.addoption("--write-live", action="store_true",
                    help=("Also run the steps that PERSIST changes to live application "
                          "data: new patients, visit logs, vaccination events and website "
                          "settings. Off by default - visit rows feed patient_visit_records "
                          "and the vaccination series, which are the inputs to the disease "
                          "analytics and the ARIMA forecast, and website settings change "
                          "what the public landing page shows."))


def pytest_configure(config):  # noqa: A002 - pytest fixes this parameter name
    # `config` here is pytest's Config object, which shadows the support.config
    # module for the length of this function - so reach it under another name.
    from support import config as app_config

    if config.getoption("--base-url"):
        app_config.BASE_URL = config.getoption("--base-url").rstrip("/")
        # pages.py and auth.py both froze URLs at import time (auth.NEUTRAL_PAGE
        # among them). Reload mutates those module objects in place, so every
        # `from support import pages` binding elsewhere sees the new values.
        import importlib

        importlib.reload(pages)
        importlib.reload(auth)
    if config.getoption("--headed"):
        app_config.HEADLESS = False


# ---------------------------------------------------------------------------
# preflight - fail loudly and early rather than 40 confusing failures
# ---------------------------------------------------------------------------


def _http_ok(url: str, timeout: float = 5) -> bool:
    try:
        with urllib.request.urlopen(url, timeout=timeout) as response:
            return 200 <= response.status < 400
    except (urllib.error.URLError, socket.timeout, ValueError):
        return False


def _clear_run_artifacts() -> None:
    """Empties the evidence folders so a report only ever shows this run.

    Screenshots and downloads accumulate otherwise, and a stale
    TC-XX-FAILURE.png sitting next to a passing row is worse than no evidence.
    """
    import shutil

    for folder in (config.SHOT_DIR, os.path.join(config.REPORT_DIR, "downloads")):
        shutil.rmtree(folder, ignore_errors=True)
        os.makedirs(folder, exist_ok=True)


@pytest.fixture(scope="session", autouse=True)
def preflight(pytestconfig):
    """Checks the world is in a state where the suite can mean anything."""
    _clear_run_artifacts()
    problems: list[str] = []

    remote = config.is_remote()

    if not _http_ok(pages.LOGIN):
        problems.append(
            f"The app is not being served at {config.BASE_URL}."
            + ("\n    Check the host is up and the URL is right."
               if remote else
               "\n    Start Apache in the XAMPP Control Panel, or pass --base-url.")
        )

    # dbq.php talks to the LOCAL database. Against a remote target it would be
    # reading a different installation's rows, so it is deliberately not used
    # and the tests that need it skip themselves.
    db_usable = (not remote) and db.available()

    if remote:
        if db.available():
            pytestconfig._bvetter_db_note = (
                "A local database is reachable but is NOT being used: the target is "
                "remote, so its codes and tokens belong to a different installation."
            )
    elif not db_usable:
        problems.append(
            f"Could not reach the database through {config.PHP_BIN}.\n"
            "    Start MySQL in XAMPP, or set BVETTER_PHP_BIN to your php.exe."
        )
    else:
        for label, email in (
            ("pet owner", config.OWNER_EMAIL),
            ("veterinarian", config.VET_EMAIL),
            ("admin", config.ADMIN_EMAIL),
        ):
            row = db.user(email)
            if not row:
                problems.append(
                    f"The {label} test account {email} does not exist.\n"
                    "    Create the three test accounts with:\n"
                    "        php tests/selenium/support/seed.php"
                )
                break
            if row["account_status"] != "active":
                problems.append(
                    f"The {label} test account {email} is '{row['account_status']}', not active.\n"
                    "    Re-run: php tests/selenium/support/seed.php"
                )

    if problems:
        pytest.exit("\n\nPREFLIGHT FAILED\n\n  " + "\n\n  ".join(problems) + "\n", returncode=3)

    pytestconfig._bvetter_remote = remote
    pytestconfig._bvetter_db_usable = db_usable

    _reporter.environment = {
        "Base URL": config.BASE_URL,
        "Target": "REMOTE" if remote else "local",
        "Browser": config.BROWSER + (" (headless)" if config.HEADLESS else " (headed)"),
        "Python": sys.version.split()[0],
        "DB helper": "in use" if db_usable else "not used (remote target)",
        "Writes allowed": (
            "yes" if (not remote or pytestconfig.getoption("--allow-remote-writes"))
            else "no (remote, read-only)"
        ),
        "Idle timeout": f"{db.idle_minutes()} min" if db_usable else "unknown (no DB access)",
        "Analytics service": "up" if _http_ok("http://127.0.0.1:5001/health", 2) else "down",
        "CDN reachable": "yes" if _http_ok("https://cdn.jsdelivr.net/npm/chart.js", 6) else "no",
    }
    yield

    # Never run cleanup against a remote target: dbq.php would be deleting rows
    # from the LOCAL database, which this run never touched.
    if not remote and not pytestconfig.getoption("--keep-data"):
        try:
            deleted = db.cleanup()
            total = sum(deleted.values())
            if total:
                print(f"\nCleaned up {total} [SELENIUM]-tagged row(s): {deleted}")
        except Exception as exc:  # cleanup must never mask a real failure
            print(f"\nCleanup skipped: {exc}")


@pytest.fixture(scope="session")
def third_party_assets(browser, pytestconfig) -> dict:
    """Can the app's pages load their CDN libraries at all?

    Chart.js, FullCalendar, Leaflet and Google Fonts are all cross-origin.
    Whether they load is a property of the app, not of the test: sw.js proxies
    every request through the service worker, and the worker inherits the page
    CSP's `connect-src 'self'`, so while a service worker is installed the
    browser cannot fetch any of them.

    Probed once, on a real app page, under the same conditions a user gets -
    so a "charts did not render" result can name its cause instead of just
    reporting a blank canvas.
    """
    browser.get(auth.NEUTRAL_PAGE)
    time.sleep(1.5)  # let the load event fire so sw registration happens

    controlled = browser.execute_script(
        "return !!(navigator.serviceWorker && navigator.serviceWorker.controller);"
    )
    ok = probe_external_script(browser, "https://cdn.jsdelivr.net/npm/chart.js")

    reason = ""
    if not ok:
        if controlled:
            reason = (
                "A service worker is controlling the page. sw.js re-issues every "
                "request with fetch(event.request), and the worker inherits the CSP "
                "connect-src 'self' from .htaccess - so no cross-origin library "
                "(Chart.js, FullCalendar, Leaflet, Google Fonts) can load."
            )
        elif _reporter.environment.get("CDN reachable") != "yes":
            reason = "The machine has no route to the CDN (offline or blocked upstream)."
        else:
            reason = "The CDN is reachable from this machine but the page could not load it."

    if pytestconfig.getoption("--bypass-sw"):
        removed = unregister_service_workers(browser)
        browser.get(auth.NEUTRAL_PAGE)
        time.sleep(1.0)
        bypassed = probe_external_script(browser, "https://cdn.jsdelivr.net/npm/chart.js")
        return {
            "ok": bypassed,
            "reason": "" if bypassed else reason,
            "sw_controlled": controlled,
            "sw_removed": removed,
            "bypassed": True,
        }

    return {"ok": ok, "reason": reason, "sw_controlled": controlled, "bypassed": False}


@pytest.fixture
def charts(third_party_assets, driver, pytestconfig):
    """Per-test view of whether chart libraries are usable on this page load."""
    if pytestconfig.getoption("--bypass-sw"):
        unregister_service_workers(driver)
    return third_party_assets


@pytest.fixture(scope="session")
def analytics_available() -> bool:
    """The Flask ARIMA service on :5001 does not start with XAMPP."""
    return _reporter.environment.get("Analytics service") == "up"


# ---------------------------------------------------------------------------
# browser
# ---------------------------------------------------------------------------


def _build_driver():
    width, _, height = config.WINDOW_SIZE.partition(",")
    if config.BROWSER.lower() in ("edge", "msedge"):
        options = EdgeOptions()
        maker = webdriver.Edge
    else:
        options = ChromeOptions()
        maker = webdriver.Chrome

    if config.HEADLESS:
        options.add_argument("--headless=new")
    options.add_argument(f"--window-size={width},{height}")
    options.add_argument("--disable-gpu")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    # Keeps a first-run password-manager bubble from stealing focus mid-test.
    options.add_argument("--disable-features=PasswordLeakDetection,AutofillServerCommunication")
    options.add_experimental_option("prefs", {
        "credentials_enable_service": False,
        "profile.password_manager_enabled": False,
        "download.prompt_for_download": False,
        "download.default_directory": os.path.join(config.REPORT_DIR, "downloads"),
    })
    options.set_capability("goog:loggingPrefs", {"browser": "ALL"})

    driver = maker(options=options)
    driver.set_page_load_timeout(60)
    driver.implicitly_wait(config.IMPLICIT_WAIT)
    return driver


#: Injected before any page script runs when --bypass-sw is given.
#  Unregistering once is not enough: shared/js/pwa-register.js re-registers on
#  every page's load event, and sw.js calls skipWaiting()+clients.claim(), so a
#  fresh worker takes control again within the same navigation. Neutering
#  register() is the only way to keep a page genuinely uncontrolled.
_DISABLE_SW = """
(() => {
  try {
    const proto = Object.getPrototypeOf(navigator.serviceWorker);
    Object.defineProperty(proto, 'register', {
      configurable: true,
      value: () => Promise.reject(new Error('service worker disabled for testing')),
    });
  } catch (e) { /* browser without SW support - nothing to disable */ }
})();
"""


@pytest.fixture(scope="session")
def browser(pytestconfig):
    os.makedirs(os.path.join(config.REPORT_DIR, "downloads"), exist_ok=True)
    driver = _build_driver()

    if pytestconfig.getoption("--bypass-sw"):
        try:
            driver.execute_cdp_cmd(
                "Page.addScriptToEvaluateOnNewDocument", {"source": _DISABLE_SW}
            )
        except Exception as exc:
            print(f"\n--bypass-sw: could not disable service-worker registration ({exc})")
        driver.get(auth.NEUTRAL_PAGE)
        unregister_service_workers(driver)

    yield driver
    driver.quit()


@pytest.fixture
def driver(browser, request):
    """One clean browser state per test, without paying for a new browser."""
    browser.delete_all_cookies()
    try:
        if not browser.current_url.startswith(config.BASE_URL):
            browser.get(auth.NEUTRAL_PAGE)
        browser.execute_script("localStorage.clear(); sessionStorage.clear();")
    except Exception:
        browser.get(auth.NEUTRAL_PAGE)
        browser.execute_script("localStorage.clear(); sessionStorage.clear();")

    # Drain the console log so anything a test reports as a console error
    # belongs to that test, not to whichever one ran before it.
    try:
        browser.get_log("browser")
    except Exception:
        pass

    request.node._bvetter_driver = browser
    yield browser


# ---------------------------------------------------------------------------
# logged-in sessions, captured once and re-used
# ---------------------------------------------------------------------------


def _session_fixture(browser, login_callable, email, remote: bool):
    cache: dict = {}

    def get() -> dict:
        # A remote run has no seeded accounts unless somebody made them. Say so
        # once, clearly, instead of failing every logged-in test on a password
        # that was never going to work.
        if remote and email in config.SEEDED_EMAILS:
            pytest.skip(
                f"No credentials configured for {email} on {config.BASE_URL}. "
                "Set BVETTER_OWNER_EMAIL / BVETTER_OWNER_PASSWORD (and the VET_ / "
                "ADMIN_ equivalents) to real accounts on that host."
            )
        if cache and auth.session_is_live(browser, cache):
            return cache
        browser.delete_all_cookies()
        if not browser.current_url.startswith(config.BASE_URL):
            browser.get(auth.NEUTRAL_PAGE)
        browser.execute_script("localStorage.clear(); sessionStorage.clear();")
        outcome = login_callable(browser)
        if outcome != "session":
            note = auth.notice_message(browser) or outcome
            raise AssertionError(f"Could not log in as {email}: {note}")
        cache.clear()
        cache.update(auth.capture_session(browser))
        return dict(cache)

    return get


@pytest.fixture(scope="session")
def owner_login(browser, pytestconfig):
    return _session_fixture(browser, auth.login_owner, config.OWNER_EMAIL,
                            getattr(pytestconfig, "_bvetter_remote", False))


@pytest.fixture(scope="session")
def vet_login(browser, pytestconfig):
    return _session_fixture(browser, auth.login_vet, config.VET_EMAIL,
                            getattr(pytestconfig, "_bvetter_remote", False))


@pytest.fixture(scope="session")
def admin_login(browser, pytestconfig):
    # Admin login needs the emailed 2FA code, which only the database can
    # supply, so a remote run cannot complete it at all.
    if getattr(pytestconfig, "_bvetter_remote", False) and not pytestconfig._bvetter_db_usable:
        def refuse() -> dict:
            pytest.skip(
                "Admin login is gated by email two-factor and the code lives in "
                "login_otp_codes on the target host, which this run cannot read. "
                "Admin cases need either a local target or DB access to the remote one."
            )
        return refuse
    return _session_fixture(browser, auth.login_admin, config.ADMIN_EMAIL,
                            getattr(pytestconfig, "_bvetter_remote", False))


@pytest.fixture
def owner_session(owner_login) -> dict:
    return owner_login()


@pytest.fixture
def vet_session(vet_login) -> dict:
    return vet_login()


@pytest.fixture
def admin_session(admin_login) -> dict:
    return admin_login()


@pytest.fixture
def as_owner(driver, owner_session):
    def open_page(url: str):
        auth.prepare_page(driver, url, owner_session)
        return driver
    open_page.session = owner_session
    return open_page


@pytest.fixture
def as_vet(driver, vet_session):
    def open_page(url: str):
        auth.prepare_page(driver, url, vet_session)
        return driver
    open_page.session = vet_session
    return open_page


@pytest.fixture
def as_admin(driver, admin_session):
    def open_page(url: str):
        auth.prepare_page(driver, url, admin_session)
        return driver
    open_page.session = admin_session
    return open_page


# ---------------------------------------------------------------------------
# the per-test record the report is built from
# ---------------------------------------------------------------------------


class TestCaseHandle:
    """What a test uses to attach evidence to its Test Case ID."""

    def __init__(self, record, driver=None):
        self._record = record
        self._driver = driver

    def measure(self, key: str, value) -> None:
        self._record.measured[key] = value

    def note(self, message: str) -> None:
        self._record.notes.append(message)

    def shot(self, name: str) -> None:
        if self._driver is None:
            return
        path = screenshot(self._driver, f"{self._record.tc_id or 'test'}-{name}")
        if path:
            self._record.screenshots.append(path)

    @property
    def id(self) -> str:
        return self._record.tc_id


@pytest.fixture
def tc(request):
    record = _reporter.record_for(request.node.nodeid)
    marker = request.node.get_closest_marker("testcase")
    if marker:
        record.tc_id = marker.kwargs.get("tc_id", "")
        record.feature = marker.kwargs.get("feature", "")
        record.expected = marker.kwargs.get("expected", "")
        record.category = marker.kwargs.get("category", "")
        record.role = marker.kwargs.get("role", "")
    driver = getattr(request.node, "_bvetter_driver", None)
    handle = TestCaseHandle(record, driver)
    request.node._bvetter_tc = handle
    return handle


@pytest.fixture
def remote(request) -> bool:
    """True when the run is pointed at a host other than this machine."""
    return bool(getattr(request.config, "_bvetter_remote", config.is_remote()))


def _require_credentials(request, email: str, role_label: str) -> None:
    """Skips when the run has no usable account for this role on the target.

    The session fixtures already do this, but the login test cases authenticate
    directly - they ARE the login - so they need the same guard or they fail on
    a password that was never going to exist on a remote host.
    """
    if not getattr(request.config, "_bvetter_remote", config.is_remote()):
        return
    if email in config.SEEDED_EMAILS:
        pytest.skip(
            f"No {role_label} credentials configured for {config.BASE_URL}. "
            f"Set BVETTER_{role_label.upper()}_EMAIL and "
            f"BVETTER_{role_label.upper()}_PASSWORD to a real account on that host."
        )


@pytest.fixture
def owner_credentials(request):
    _require_credentials(request, config.OWNER_EMAIL, "owner")


@pytest.fixture
def vet_credentials(request):
    _require_credentials(request, config.VET_EMAIL, "vet")


@pytest.fixture
def admin_credentials(request):
    _require_credentials(request, config.ADMIN_EMAIL, "admin")
    if not getattr(request.config, "_bvetter_db_usable", True):
        pytest.skip(
            "Admin login is gated by email two-factor and the code lives in "
            "login_otp_codes on the target host, which this run cannot read."
        )


@pytest.fixture
def needs_db(request):
    """Skips a test that cannot mean anything without database access.

    Three flows are gated on something only the database can supply — the
    emailed OTP, the emailed reset token, and the session clock. Against a
    remote host dbq.php would be reading a different installation, so those
    tests are skipped with the reason rather than asserted against the wrong
    rows.
    """
    if not getattr(request.config, "_bvetter_db_usable", True):
        pytest.skip(
            "Needs database access to read an emailed code / age a session. "
            "The target is remote, so the local dbq.php helper does not apply. "
            "Run this case against localhost, or give the suite DB access to the "
            "remote host."
        )
    return True


@pytest.fixture
def mutating(request):
    """Marks a test as a writer; --no-mutate skips it.

    Against a remote host it also needs --allow-remote-writes: on bvetter.me
    these steps create real appointments, real lost-and-found reports and real
    accounts, and the app emails real people about them.
    """
    if request.config.getoption("--no-mutate"):
        pytest.skip("--no-mutate: skipping a test that writes to the database")
    if (getattr(request.config, "_bvetter_remote", config.is_remote())
            and not request.config.getoption("--allow-remote-writes")):
        pytest.skip(
            "Writes to a remote target are off by default. This test would create "
            "real data on "
            f"{config.BASE_URL} and trigger real notification email. "
            "Re-run with --allow-remote-writes if that is intended."
        )
    return True


@pytest.fixture
def write_live(request) -> bool:
    """Whether the run may persist changes to live application data."""
    return bool(request.config.getoption("--write-live"))


@pytest.fixture(autouse=True)
def _slow_mode(request):
    yield
    if request.config.getoption("--slow"):
        time.sleep(1.2)


# ---------------------------------------------------------------------------
# hooks
# ---------------------------------------------------------------------------


@pytest.hookimpl(hookwrapper=True)
def pytest_runtest_makereport(item, call):
    outcome = yield
    report = outcome.get_result()
    if report.when != "call" and not (report.when == "setup" and report.outcome == "skipped"):
        if not (report.when == "setup" and report.failed):
            return

    record = _reporter.record_for(item.nodeid)
    marker = item.get_closest_marker("testcase")
    if marker and not record.tc_id:
        record.tc_id = marker.kwargs.get("tc_id", "")
        record.feature = marker.kwargs.get("feature", "")
        record.expected = marker.kwargs.get("expected", "")
        record.category = marker.kwargs.get("category", "")
        record.role = marker.kwargs.get("role", "")

    record.duration = max(record.duration, round(report.duration, 3))
    record.outcome = report.outcome
    if report.failed:
        record.outcome = "failed"
        record.failure = str(report.longrepr).strip()[-1500:]
        driver = getattr(item, "_bvetter_driver", None)
        if driver is not None:
            path = screenshot(driver, f"{record.tc_id or item.name}-FAILURE")
            if path:
                record.screenshots.append(path)
    elif report.skipped:
        record.outcome = "skipped"
        reason = ""
        if isinstance(report.longrepr, tuple) and len(report.longrepr) == 3:
            reason = report.longrepr[2]
        if reason:
            record.notes.append(str(reason))


def pytest_terminal_summary(terminalreporter):
    if not _reporter.records:
        return
    paths = _reporter.write()
    terminalreporter.write_sep("=", "BVetter test-case report")
    for label, path in paths.items():
        terminalreporter.write_line(f"  {label:<5} {path}")
