"""Waiting, timing, evidence-capture and small DOM utilities.

The BVetter pages render almost everything from JavaScript after a fetch() has
come back, so "the element exists" and "the page is ready" are rarely the same
moment. Nearly every helper here waits on a *rendered outcome* rather than on
the element merely being in the DOM.
"""

from __future__ import annotations

import os
import re
import struct
import time
import zlib
from contextlib import contextmanager

from selenium.common.exceptions import (
    ElementClickInterceptedException,
    StaleElementReferenceException,
    TimeoutException,
)
from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import Select, WebDriverWait

from . import config

__all__ = [
    "By",
    "wait",
    "present",
    "visible",
    "clickable",
    "click",
    "type_into",
    "select_by_text",
    "select_by_value",
    "text_of",
    "exists",
    "is_displayed",
    "wait_for_js",
    "wait_for_url_contains",
    "document_ready",
    "nav_timing",
    "canvas_rendered",
    "element_count",
    "stopwatch",
    "screenshot",
    "dismiss_overlays",
    "png_fixture",
    "pdf_fixture",
    "js_fetch",
    "console_errors",
]


# ---------------------------------------------------------------------------
# waiting
# ---------------------------------------------------------------------------


def wait(driver, timeout: float | None = None) -> WebDriverWait:
    return WebDriverWait(
        driver,
        timeout if timeout is not None else config.DEFAULT_TIMEOUT,
        poll_frequency=0.15,
        ignored_exceptions=(StaleElementReferenceException,),
    )


def present(driver, locator, timeout: float | None = None):
    return wait(driver, timeout).until(EC.presence_of_element_located(locator))


def visible(driver, locator, timeout: float | None = None):
    return wait(driver, timeout).until(EC.visibility_of_element_located(locator))


def clickable(driver, locator, timeout: float | None = None):
    return wait(driver, timeout).until(EC.element_to_be_clickable(locator))


def click(driver, locator, timeout: float | None = None):
    """Click, surviving sticky headers and animated overlays.

    Several BVetter screens have a fixed navbar and modal overlays that fade
    over 300ms; a plain .click() lands on the overlay often enough to make a
    suite flaky. Scroll it to the middle first, then fall back to a JS click.
    """
    for attempt in range(3):
        element = clickable(driver, locator, timeout)
        try:
            driver.execute_script(
                "arguments[0].scrollIntoView({block:'center', inline:'center'});", element
            )
            element.click()
            return element
        except ElementClickInterceptedException:
            driver.execute_script("arguments[0].click();", element)
            return element
        except StaleElementReferenceException:
            # The panel re-rendered between finding it and clicking it; look
            # the element up again rather than failing the case.
            if attempt == 2:
                raise
            time.sleep(0.2)
    raise TimeoutException(f"Could not click {locator}")


def type_into(driver, locator, value, clear: bool = True):
    element = visible(driver, locator)
    driver.execute_script("arguments[0].scrollIntoView({block:'center'});", element)
    if clear:
        element.clear()
    element.send_keys(str(value))
    return element


def _set_native(driver, element, value: str) -> None:
    """Sets an <input type=date> etc. and fires the events the page listens for."""
    driver.execute_script(
        """
        const el = arguments[0], value = arguments[1];
        const proto = Object.getPrototypeOf(el);
        const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
        setter.call(el, value);
        el.dispatchEvent(new Event('input',  {bubbles:true}));
        el.dispatchEvent(new Event('change', {bubbles:true}));
        """,
        element,
        value,
    )


def set_date(driver, locator, iso_date: str):
    element = present(driver, locator)
    _set_native(driver, element, iso_date)
    return element


def select_by_text(driver, locator, text):
    Select(visible(driver, locator)).select_by_visible_text(text)


def select_by_value(driver, locator, value):
    Select(visible(driver, locator)).select_by_value(str(value))


def select_first_real_option(driver, locator):
    """Picks the first option that is not a placeholder, and returns its text.

    Most BVetter selects are populated from an API call and start with a
    'Select barangay'-style option that has an empty value.
    """
    element = visible(driver, locator)
    wait(driver).until(lambda d: len(element.find_elements(By.TAG_NAME, "option")) > 1)
    select = Select(element)
    for index, option in enumerate(select.options):
        # Options written as <option>Dog</option> have no value ATTRIBUTE, so
        # select_by_value() cannot find them even though .value reads back as
        # the label. Selecting by index sidesteps that entirely.
        if not (option.get_attribute("value") or "").strip():
            continue
        if option.get_attribute("disabled"):
            continue
        select.select_by_index(index)
        return option.text.strip()
    raise AssertionError(f"No selectable option in {locator}")


def text_of(driver, locator, timeout: float | None = None) -> str:
    """Visible text of an element, tolerant of a re-render between find and read.

    These pages replace whole panels with innerHTML after a fetch resolves, so
    an element handle can go stale in the microseconds between the wait
    returning it and .text being read. Retry rather than fail the case over a
    race that has nothing to do with what is under test.
    """
    deadline = time.monotonic() + (timeout if timeout is not None else config.DEFAULT_TIMEOUT)
    last: Exception | None = None
    while time.monotonic() < deadline:
        try:
            return visible(driver, locator, timeout).text.strip()
        except StaleElementReferenceException as exc:
            last = exc
            time.sleep(0.15)
    raise last or TimeoutException(f"Could not read text of {locator}")


def exists(driver, locator) -> bool:
    return bool(driver.find_elements(*locator))


def is_displayed(driver, locator) -> bool:
    elements = driver.find_elements(*locator)
    return bool(elements) and elements[0].is_displayed()


def wait_for_js(driver, script: str, timeout: float | None = None, message: str = ""):
    """Waits until a JS expression returns something truthy, then returns it."""
    try:
        return wait(driver, timeout).until(
            lambda d: d.execute_script(f"return ({script});")
        )
    except TimeoutException as exc:
        raise TimeoutException(message or f"JS condition never became true: {script}") from exc


def wait_for_url_contains(driver, fragment: str, timeout: float | None = None):
    return wait(driver, timeout).until(EC.url_contains(fragment))


def document_ready(driver, timeout: float | None = None):
    return wait_for_js(driver, "document.readyState === 'complete'", timeout)


# ---------------------------------------------------------------------------
# rendering checks
# ---------------------------------------------------------------------------


def nav_timing(driver) -> dict:
    """Navigation Timing figures for the document currently loaded."""
    return driver.execute_script(
        """
        const nav = performance.getEntriesByType('navigation')[0];
        if (!nav) return null;
        return {
            responseEnd: nav.responseEnd,
            domContentLoaded: nav.domContentLoadedEventEnd,
            loadEvent: nav.loadEventEnd
        };
        """
    )


# NOTE: kept on one leading line deliberately. `return` followed by a newline
# is terminated by automatic semicolon insertion, so a template that starts
# with a blank line makes execute_script("return " + script) return undefined
# no matter what the body does.
_CANVAS_PAINTED = """(function(){
  var c = document.getElementById(arguments_id);
  if (!c || !c.getContext) return false;
  if (!c.width || !c.height) return false;
  try {
    var d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    for (var i = 3; i < d.length; i += 4) { if (d[i] !== 0) return true; }
    return false;
  } catch (e) { return false; }
})()
"""


def canvas_rendered(driver, canvas_id: str, timeout: float | None = None) -> bool:
    """True once a <canvas> actually has non-transparent pixels on it.

    Chart.js sizes its canvas immediately but paints a frame later, so
    'the element is visible' is not proof the chart drew. Reading the pixels
    back is.
    """
    script = "return " + _CANVAS_PAINTED.replace("arguments_id", repr(canvas_id)).strip()
    try:
        return bool(wait(driver, timeout).until(lambda d: d.execute_script(script)))
    except TimeoutException:
        return False


def element_count(driver, locator) -> int:
    return len(driver.find_elements(*locator))


def wait_for_count(driver, locator, minimum: int = 1, timeout: float | None = None):
    """Waits until at least `minimum` elements match - i.e. a list has filled in."""
    return wait(driver, timeout).until(
        lambda d: len(d.find_elements(*locator)) >= minimum
    )


def has_digits(value: str) -> bool:
    """A KPI card that still reads '--' or '0' has not loaded yet."""
    return bool(re.search(r"\d", value or ""))


# ---------------------------------------------------------------------------
# timing
# ---------------------------------------------------------------------------


@contextmanager
def stopwatch(record: dict, key: str = "seconds"):
    """Wall-clock timing around a block, written into `record`."""
    started = time.perf_counter()
    try:
        yield
    finally:
        record[key] = round(time.perf_counter() - started, 3)


# ---------------------------------------------------------------------------
# evidence
# ---------------------------------------------------------------------------


def screenshot(driver, name: str) -> str | None:
    os.makedirs(config.SHOT_DIR, exist_ok=True)
    safe = re.sub(r"[^A-Za-z0-9._-]+", "_", name)[:120]
    path = os.path.join(config.SHOT_DIR, f"{safe}.png")
    try:
        driver.save_screenshot(path)
        return path
    except Exception:
        return None


def console_errors(driver) -> list[str]:
    """Severe browser-console entries, for the usability/regression checks."""
    try:
        entries = driver.get_log("browser")
    except Exception:
        return []
    return [e["message"] for e in entries if e.get("level") == "SEVERE"]


def texts_of(driver, css: str) -> list[str]:
    """textContent of every match, read through JS.

    WebElement.text returns '' for anything the browser considers hidden, and
    several BVetter panels (the collapsed sidebar, off-screen KPI cards) are
    populated but not "visible" by that definition. textContent reports what
    the page actually rendered.
    """
    return driver.execute_script(
        "return Array.from(document.querySelectorAll(arguments[0]))"
        ".map(el => (el.textContent || '').trim()).filter(Boolean);",
        css,
    )


def unregister_service_workers(driver) -> bool:
    """Removes any installed service worker and returns whether one was there.

    See the `third_party_assets` fixture: BVetter's sw.js proxies every
    request through the worker, and the worker inherits the page CSP's
    connect-src 'self', so while it is installed no cross-origin library can
    load at all.
    """
    driver.set_script_timeout(20)
    return bool(
        driver.execute_async_script(
            """
            const done = arguments[0];
            if (!('serviceWorker' in navigator)) return done(false);
            navigator.serviceWorker.getRegistrations()
                .then(rs => Promise.all(rs.map(r => r.unregister())).then(() => done(rs.length > 0)))
                .catch(() => done(false));
            """
        )
    )


def probe_external_script(driver, src: str, timeout: float = 25) -> bool:
    """True if the page can load a cross-origin <script src> right now."""
    driver.set_script_timeout(timeout + 5)
    return driver.execute_async_script(
        """
        const [src, done] = arguments;
        const s = document.createElement('script');
        let settled = false;
        const finish = (v) => { if (!settled) { settled = true; done(v); } };
        s.src = src;
        s.onload = () => finish(true);
        s.onerror = () => finish(false);
        document.head.appendChild(s);
        setTimeout(() => finish(false), 20000);
        """,
        src,
    )


def resource_mark(driver) -> int:
    """How many resources the page has fetched so far - a cursor for the below."""
    return driver.execute_script("return performance.getEntriesByType('resource').length;")


def api_request_seconds(driver, url_fragment: str, since: int = 0) -> float | None:
    """The slowest request matching `url_fragment` made after `since`.

    Read from the browser's Resource Timing buffer, so a slow screen can be
    attributed to the server round trip rather than to rendering - the
    difference between "the page is heavy" and "the endpoint is slow".

    The *slowest* rather than the last, because a submit handler usually fires
    several calls to the same endpoint (create, then reload the list) and it is
    the create that the user is waiting on.
    """
    value = driver.execute_script(
        """
        const [frag, since] = arguments;
        const hits = performance.getEntriesByType('resource')
            .slice(since)
            .filter(e => e.name.indexOf(frag) !== -1);
        if (!hits.length) return null;
        return Math.max.apply(null, hits.map(e => e.duration));
        """,
        url_fragment,
        since,
    )
    return round(value / 1000.0, 3) if value else None


def vb_alert_message(driver) -> str | None:
    """Text of the shared vbAlert() overlay, if one is on screen.

    Several pages report validation failures through this overlay instead of
    an inline message, so a test that just times out waiting for a success
    screen would otherwise never say what went wrong.
    """
    return driver.execute_script(
        """
        const overlay = document.getElementById('vbAlertOverlay');
        if (!overlay || overlay.style.display === 'none') return null;
        const msg = overlay.querySelector('.vb-alert-msg');
        return msg ? msg.textContent.trim() : null;
        """
    )


def dismiss_overlays(driver) -> None:
    """Closes the chatbot teaser and any shared vbAlert/vbConfirm overlay.

    These are injected by shared/js/auth.js and public/js/chatbot.js on top of
    whatever page is open and will intercept clicks aimed at the page beneath.
    """
    driver.execute_script(
        """
        document.getElementById('chatbotTeaser')?.remove();
        const panel = document.getElementById('chatbotPanel');
        if (panel) panel.style.display = 'none';
        ['vbAlertOverlay','vbConfirmOverlay','vbIdleOverlay'].forEach(function(id){
            const el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });
        """
    )


# ---------------------------------------------------------------------------
# upload fixtures (generated, so no binaries are committed)
# ---------------------------------------------------------------------------


def _png_bytes(width: int = 240, height: int = 160, rgb=(38, 132, 255)) -> bytes:
    """A valid solid-colour PNG, built with the standard library only."""

    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    raw = b"".join(
        b"\x00" + bytes(rgb) * width for _ in range(height)
    )  # filter byte 0 per scanline
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )


def png_fixture(name: str = "residency-proof.png") -> str:
    """Path to a generated PNG, for file-upload inputs."""
    fixtures = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "fixtures"
    )
    os.makedirs(fixtures, exist_ok=True)
    path = os.path.join(fixtures, name)
    if not os.path.exists(path):
        with open(path, "wb") as handle:
            handle.write(_png_bytes())
    return path


def pdf_fixture(name: str = "residency-proof.pdf") -> str:
    """Path to a minimal but structurally valid one-page PDF."""
    fixtures = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "fixtures"
    )
    os.makedirs(fixtures, exist_ok=True)
    path = os.path.join(fixtures, name)
    if not os.path.exists(path):
        body = (
            b"%PDF-1.4\n"
            b"1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
            b"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
            b"3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\n"
            b"trailer<</Root 1 0 R>>\n%%EOF\n"
        )
        with open(path, "wb") as handle:
            handle.write(body)
    return path


# ---------------------------------------------------------------------------
# API probing from inside the page (keeps cookies/origin identical)
# ---------------------------------------------------------------------------


def js_fetch(driver, url: str, method: str = "GET", body=None, token: str | None = None,
             json_body: bool = True, timeout: float = 30) -> dict:
    """Runs a fetch() in page context and returns {status, text}.

    Used for the API-layer half of the security cases: what the browser is
    *shown* and what the endpoint actually *returns* are two different
    guarantees, and TC-**-S03/S05 care about the second one.

    Note: shared/js/auth.js wraps window.fetch and attaches the bearer token
    from localStorage. `token=None` plus a cleared localStorage is therefore a
    genuinely unauthenticated call.
    """
    driver.set_script_timeout(timeout)
    return driver.execute_async_script(
        """
        const [url, method, body, token, jsonBody, done] = arguments;
        const headers = {};
        if (token) headers['Authorization'] = 'Bearer ' + token;
        // PHP only fills $_POST when the request declares a form content type,
        // so a raw string body without this header reaches the endpoint as an
        // empty $_POST and gets rejected as a validation error rather than on
        // its merits.
        if (body && jsonBody) headers['Content-Type'] = 'application/json';
        if (body && !jsonBody) headers['Content-Type'] = 'application/x-www-form-urlencoded';
        fetch(url, {
            method: method,
            headers: headers,
            body: body ? (jsonBody ? JSON.stringify(body) : body) : undefined
        })
        .then(r => r.text().then(t => done({status: r.status, text: t})))
        .catch(e => done({status: 0, text: String(e)}));
        """,
        url,
        method,
        body,
        token,
        json_body,
    )
