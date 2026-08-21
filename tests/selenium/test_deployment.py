"""Deployment-level checks  (TC-ENV-01 .. TC-ENV-04).

These four are NOT in the written test plan. They exist because the plan's
security cases all assume the deployment is configured the way the repository
says it is, and that assumption is worth testing directly — especially when
the same code is served from two very different Apache setups (XAMPP locally,
Ubuntu on the droplet).

Every check here is read-only: a HEAD/GET and a look at what came back. None of
them log in, submit anything, or write a single row, so they are safe to point
at production.
"""

from __future__ import annotations

import socket
import urllib.error
import urllib.request

import pytest

from support import auth, config, pages
from support.helpers import probe_external_script, unregister_service_workers
from support.marks import testcase

#: Paths .htaccess is supposed to deny outright.
PROTECTED_PATHS = [
    ".env",
    "composer.json",
    "composer.lock",
    "README.md",
    "TECHNICAL_MANUAL.md",
    "STUDY_GUIDE.md",
    "phpunit.xml",
    "database/bvetter.sql",
    "api/analytics/arima_service.py",
    "reset-links.log",
]

#: Headers .htaccess sets inside <IfModule mod_headers.c>. That guard means a
#: server without mod_headers drops all of them SILENTLY - no error, no log.
EXPECTED_HEADERS = {
    "content-security-policy": "Content-Security-Policy",
    "x-content-type-options": "X-Content-Type-Options",
    "x-frame-options": "X-Frame-Options",
    "referrer-policy": "Referrer-Policy",
}


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """Stops urllib following redirects, so a 301 stays visible as a 301."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def _fetch(url: str, method: str = "GET", timeout: float = 20, follow: bool = True):
    """Returns (status, headers dict lowercased, first 400 bytes of body)."""
    request = urllib.request.Request(url, method=method)
    request.add_header("User-Agent", "BVetter-Selenium-Suite")
    opener = (
        urllib.request.build_opener()
        if follow
        else urllib.request.build_opener(_NoRedirect)
    )
    try:
        with opener.open(request, timeout=timeout) as response:
            body = response.read(400)
            return response.status, {k.lower(): v for k, v in response.headers.items()}, body
    except urllib.error.HTTPError as exc:
        return exc.code, {k.lower(): v for k, v in exc.headers.items()}, b""
    except (urllib.error.URLError, socket.timeout) as exc:
        return 0, {}, str(exc).encode()


# ===========================================================================
# TC-ENV-01  Security headers
# ===========================================================================


@testcase(
    "TC-ENV-01", "HTTP Security Headers",
    "Every header .htaccess declares is actually present on the response",
    category="security", role="system",
)
def test_security_headers_are_served(tc):
    status, headers, _ = _fetch(pages.LANDING)
    tc.measure("status", status)
    assert status == 200, f"The landing page answered {status}"

    present = {label: headers.get(key) for key, label in EXPECTED_HEADERS.items()}
    for label, value in present.items():
        tc.measure(label, (value or "ABSENT")[:90])

    missing = [label for label, value in present.items() if not value]
    tc.measure("missing_count", len(missing))

    if missing:
        tc.note(
            "These are declared in .htaccess inside <IfModule mod_headers.c>. That guard "
            "means a server without mod_headers enabled drops every one of them silently - "
            "no error and nothing in the log. Check with: sudo a2enmod headers && "
            "sudo systemctl reload apache2"
        )
    assert not missing, (
        "Headers declared in .htaccess are not being sent: " + ", ".join(missing)
    )


# ===========================================================================
# TC-ENV-02  Sensitive files are denied
# ===========================================================================


@testcase(
    "TC-ENV-02", "Sensitive File Exposure",
    "Credentials, dumps, docs and source that .htaccess denies are not downloadable",
    category="security", role="system",
)
def test_sensitive_files_are_denied(tc):
    exposed = []
    results = {}
    for path in PROTECTED_PATHS:
        status, _, body = _fetch(f"{config.BASE_URL}/{path}")
        results[path] = status
        # 403/404 are both fine - denied or absent. Anything servable is not.
        if status == 200 and body:
            exposed.append(path)

    tc.measure("paths_checked", len(PROTECTED_PATHS))
    tc.measure("statuses", ", ".join(f"{p}={s}" for p, s in results.items())[:400])
    tc.measure("exposed", ", ".join(exposed) or "none")

    assert not exposed, (
        "These are readable over HTTP and should not be: " + ", ".join(exposed)
        + ". The <FilesMatch> deny block in .htaccess is not taking effect - check "
        "AllowOverride for this vhost."
    )


# ===========================================================================
# TC-ENV-03  Transport security
# ===========================================================================


@testcase(
    "TC-ENV-03", "Transport Security",
    "A public deployment is served over HTTPS and does not answer plain HTTP with content",
    category="security", role="system",
)
def test_transport_is_secure(tc, remote):
    if not remote:
        pytest.skip("Transport security is only meaningful against a public deployment")

    tc.measure("scheme", config.BASE_URL.split(":", 1)[0])
    assert config.BASE_URL.startswith("https://"), (
        f"The target is served over plain HTTP: {config.BASE_URL}"
    )

    status, headers, _ = _fetch(pages.LANDING)
    hsts = headers.get("strict-transport-security")
    tc.measure("hsts", hsts or "ABSENT")

    # Plain HTTP must redirect, not serve. Checked without following the
    # redirect, or a 301 would be indistinguishable from the site answering
    # over http:// directly.
    plain = config.BASE_URL.replace("https://", "http://", 1)
    http_status, http_headers, _ = _fetch(
        f"{plain}/public/pages/landing.html", follow=False
    )
    tc.measure("plain_http_status", http_status)
    tc.measure("plain_http_location", http_headers.get("location", "-")[:90])

    if not hsts:
        tc.note(
            "No Strict-Transport-Security header. Without it, a first visit typed as "
            "http:// is downgradeable in transit; the 301 alone does not prevent that. "
            "Add: Header always set Strict-Transport-Security \"max-age=31536000\" - but "
            "only once mod_headers is enabled (see TC-ENV-01), or it will do nothing."
        )

    assert 300 <= http_status < 400, (
        f"Plain HTTP answered {http_status} instead of redirecting to HTTPS"
    )
    assert (http_headers.get("location") or "").startswith("https://"), (
        f"The HTTP redirect does not point at HTTPS: {http_headers.get('location')!r}"
    )


# ===========================================================================
# TC-ENV-04  Third-party libraries load on this deployment
# ===========================================================================


@testcase(
    "TC-ENV-04", "Third-Party Library Delivery",
    "The CDN libraries the dashboards depend on actually load on this deployment",
    category="functional", role="system",
)
def test_cdn_libraries_load_on_this_deployment(browser, tc):
    """Checks the sw.js / CSP interaction on whichever host is being tested.

    Locally this fails: sw.js re-issues every request through the service
    worker, which inherits `connect-src 'self'` from the CSP, so no
    cross-origin library can load. Whether the same is true of a given
    deployment depends on whether that server sends the CSP at all - which is
    exactly why this is checked per-target rather than assumed.
    """
    browser.get(auth.NEUTRAL_PAGE)
    import time

    time.sleep(1.5)  # let the load event fire so sw registration happens

    controlled = browser.execute_script(
        "return !!(navigator.serviceWorker && navigator.serviceWorker.controller);"
    )
    tc.measure("service_worker_controlling", controlled)

    status, headers, _ = _fetch(pages.LANDING)
    csp = headers.get("content-security-policy")
    tc.measure("csp_present", bool(csp))
    if csp:
        connect = next((p.strip() for p in csp.split(";") if p.strip().startswith("connect-src")),
                       "not set")
        tc.measure("connect_src", connect)

    loaded = probe_external_script(browser, "https://cdn.jsdelivr.net/npm/chart.js")
    tc.measure("chartjs_loads", loaded)

    if not loaded:
        if controlled and csp:
            tc.note(
                "sw.js handles every request with fetch(event.request) and the worker "
                "inherits the page CSP's connect-src, so no cross-origin library can load "
                "while a service worker is installed. Fix in sw.js: return early for "
                "requests whose origin is not location.origin."
            )
        elif controlled:
            tc.note("A service worker is controlling the page and the fetch still failed.")
        else:
            tc.note("No service worker involved - this looks like a plain network failure.")

        # Confirm the diagnosis rather than asserting a guess: with the worker
        # out of the way, does the same fetch succeed?
        unregister_service_workers(browser)
        browser.get(auth.NEUTRAL_PAGE)
        time.sleep(1.0)
        without_sw = probe_external_script(browser, "https://cdn.jsdelivr.net/npm/chart.js")
        tc.measure("chartjs_loads_without_sw", without_sw)
        if without_sw:
            tc.note("Confirmed: the same request succeeds once the service worker is gone.")

    assert loaded, (
        "Chart.js cannot load on this deployment, so no dashboard chart, calendar or "
        "map can render for a real user."
    )
