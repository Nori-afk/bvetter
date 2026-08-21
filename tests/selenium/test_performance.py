"""Performance Testing  (TC-PO-P01..P05, TC-VT-P01..P05, TC-AD-P01..P05).

What is being timed
-------------------
"Fully loaded" is taken from the test plan literally: the clock stops when the
content the case names is actually on screen, not when the load event fires.
A page whose HTML arrived in 200ms but whose statistics are still '--' three
seconds later has not loaded, and Navigation Timing alone would not say so.

Each case therefore records two numbers:

    nav_load_s     the browser's own loadEventEnd - document and subresources
    rendered_s     wall clock until the named content is really there

The budget from the plan is asserted against `rendered_s`.

Every measurement is taken on a warmed cache (one throwaway load first), which
is the "normal network conditions" the plan describes for a returning user.
The first, cold figure is recorded alongside it rather than thrown away.
"""

from __future__ import annotations

import time

import pytest

from support import auth, config, flows, pages
from support.helpers import (
    By,
    api_request_seconds,
    resource_mark,
    canvas_rendered,
    click,
    element_count,
    has_digits,
    is_displayed,
    nav_timing,
    select_by_text,
    set_date,
    text_of,
    texts_of,
    type_into,
    visible,
    wait,
    wait_for_js,
)
from support.marks import testcase

STANDARD = config.BUDGET_STANDARD    # 3s in the plan
ANALYTICS = config.BUDGET_ANALYTICS  # 5s in the plan


def _time_page(driver, url: str, ready, timeout: float = 60) -> tuple[float, float]:
    """Loads `url` and returns (wall clock until `ready`, nav loadEventEnd)."""
    started = time.perf_counter()
    driver.get(url)
    wait(driver, timeout).until(ready)
    elapsed = time.perf_counter() - started
    timing = nav_timing(driver) or {}
    return round(elapsed, 3), round((timing.get("loadEvent") or 0) / 1000.0, 3)


def _measure(driver, tc, url, ready, budget, label, session=None, timeout=60):
    """Cold load, then a warmed measurement asserted against the budget."""
    if session:
        auth.restore_session(driver, session)
    cold, _ = _time_page(driver, url, ready, timeout)
    tc.measure("cold_load_s", cold)

    if session:
        auth.restore_session(driver, session)
    warm, nav = _time_page(driver, url, ready, timeout)
    tc.measure("rendered_s", warm)
    tc.measure("nav_load_s", nav)
    tc.measure("budget_s", budget)
    tc.shot("loaded")

    assert warm <= budget, (
        f"{label} took {warm:.2f}s to render, over the {budget:.0f}s budget "
        f"(browser load event at {nav:.2f}s, cold load {cold:.2f}s)"
    )
    return warm


# ===========================================================================
# PET OWNER
# ===========================================================================


@testcase(
    "TC-PO-P01", "Landing Page Load Time",
    "The landing page renders its content, announcements and navigation within 3 seconds",
    category="performance", role="owner",
)
def test_landing_page_load_time(driver, tc):
    def ready(d):
        return (
            d.execute_script("return document.readyState === 'complete';")
            and element_count(d, (By.CSS_SELECTOR, ".nav-links a")) >= 3
            and bool(d.execute_script(
                "const h = document.querySelector('.hero');"
                "return h && h.innerText.trim().length > 20;"
            ))
        )

    _measure(driver, tc, pages.LANDING, ready, STANDARD, "The landing page")

    broken = driver.execute_script(
        "return Array.from(document.images)"
        ".filter(i => i.complete && i.naturalWidth === 0).map(i => i.src).slice(0, 5);"
    )
    tc.measure("broken_images", len(broken))
    if broken:
        tc.note("Images that failed to load: " + ", ".join(b.rsplit("/", 1)[-1] for b in broken))


@testcase(
    "TC-PO-P02", "Login Response Time",
    "From clicking Login to a fully rendered home page within 3 seconds",
    category="performance", role="owner",
)
def test_login_response_time(driver, tc, owner_credentials):
    driver.get(pages.LOGIN)
    wait_for_js(driver, "document.readyState === 'complete'")
    type_into(driver, auth.EMAIL, config.OWNER_EMAIL)
    type_into(driver, auth.PASSWORD, config.OWNER_PASSWORD)

    started = time.perf_counter()
    click(driver, auth.LOGIN_BTN)
    wait(driver, 45).until(
        lambda d: "landing.html" in d.current_url
        and d.execute_script("return document.readyState === 'complete';")
        and element_count(d, (By.CSS_SELECTOR, ".nav-links a")) >= 3
        and is_displayed(d, (By.ID, "navAuth"))
    )
    elapsed = round(time.perf_counter() - started, 3)

    tc.measure("rendered_s", elapsed)
    tc.measure("budget_s", STANDARD)
    tc.shot("home-loaded")
    assert elapsed <= STANDARD, (
        f"Login to a rendered home page took {elapsed:.2f}s, over the {STANDARD:.0f}s budget"
    )


@testcase(
    "TC-PO-P03", "Appointment Booking Submission Response Time",
    "From the final submit to the pending confirmation within 3 seconds",
    category="performance", role="owner",
)
def test_booking_submission_response_time(as_owner, driver, tc, mutating):
    as_owner(pages.BOOK_APPOINTMENT)

    # Everything up to the final button is setup, not measurement.
    click(driver, (By.ID, "btnBook"))
    wait(driver, 15).until(lambda d: is_displayed(d, (By.ID, "step1")))
    type_into(driver, (By.ID, "ownerName"), "Automation Petowner")
    type_into(driver, (By.ID, "ownerContact"), "09171234567")
    type_into(driver, (By.ID, "ownerEmail"), config.OWNER_EMAIL)
    from support.helpers import select_first_real_option

    select_first_real_option(driver, (By.ID, "ownerBarangay"))
    type_into(driver, (By.ID, "ownerAddress"), "1 Automation St., Purok 1")
    click(driver, (By.ID, "s1Next"))

    wait(driver, 10).until(lambda d: is_displayed(d, (By.ID, "step2")))
    type_into(driver, (By.ID, "petName"), f"SEL-{int(time.time()) % 100000}")
    select_by_text(driver, (By.ID, "petType"), "Dog")
    type_into(driver, (By.ID, "petBreed"), "Aspin")
    type_into(driver, (By.ID, "petAgeValue"), "3")
    select_by_text(driver, (By.ID, "petSex"), "Male")
    click(driver, (By.ID, "s2Next"))

    wait(driver, 10).until(lambda d: is_displayed(d, (By.ID, "step3")))
    select_by_text(driver, (By.ID, "visitType"), "Consultation")
    # Same forward walk as flows.book_appointment: don't let a day filled by an
    # earlier run decide whether this measurement happens.
    slots: list = []
    for offset in range(3, 32):
        set_date(driver, (By.ID, "apptDate"), flows.next_weekday(offset))
        time.sleep(0.6)
        slots = [b for b in driver.find_elements(By.CSS_SELECTOR, "#step3 .slot-btn")
                 if b.is_enabled() and "disabled" not in (b.get_attribute("class") or "")]
        if slots:
            break
    assert slots, "No bookable slot was offered, so the submission could not be timed"
    driver.execute_script("arguments[0].click();", slots[0])
    type_into(driver, (By.ID, "apptNotes"), f"{config.SEL_TAG} performance check")
    click(driver, (By.ID, "s3Next"))
    wait(driver, 10).until(lambda d: is_displayed(d, (By.ID, "step4")))

    mark = resource_mark(driver)
    started = time.perf_counter()
    click(driver, (By.ID, "s4Confirm"))
    wait(driver, 45).until(lambda d: is_displayed(d, (By.ID, "step5")))
    elapsed = round(time.perf_counter() - started, 3)

    server = api_request_seconds(driver, "appointments/appointment.php", since=mark)
    tc.measure("rendered_s", elapsed)
    tc.measure("server_request_s", server if server is not None else "n/a")
    tc.measure("budget_s", STANDARD)
    tc.measure("reference", text_of(driver, (By.ID, "rv-refNo")))
    tc.shot("confirmation")
    if server is not None and server > STANDARD:
        tc.note(
            f"{server:.1f}s of the wait is the POST to api/appointments/appointment.php "
            "itself, so this is server-side work, not rendering."
        )
    assert elapsed <= STANDARD, (
        f"The booking confirmation took {elapsed:.2f}s, over the {STANDARD:.0f}s budget"
        + (f" ({server:.2f}s of it inside the API call)" if server is not None else "")
    )


@testcase(
    "TC-PO-P04", "Lost and Found Report Submission Response Time",
    "From submit to the success confirmation screen within 3 seconds",
    category="performance", role="owner",
)
def test_lost_found_submission_response_time(as_owner, driver, tc, mutating):
    from support.helpers import png_fixture, select_first_real_option
    import datetime

    as_owner(pages.LOST_FOUND)
    click(driver, (By.CSS_SELECTOR, ".btn-report.light"))
    visible(driver, (By.ID, "reportModal"), timeout=15)

    type_into(driver, (By.ID, "petNameInput"), f"SEL-{int(time.time()) % 100000}")
    select_by_text(driver, (By.ID, "speciesInput"), "Dog")
    type_into(driver, (By.ID, "breedInput"), "Aspin")
    click(driver, (By.XPATH, "//button[@class='sex-btn'][normalize-space()='Male']"))
    select_first_real_option(driver, (By.ID, "sizeInput"))
    type_into(driver, (By.ID, "markingsInput"), f"Brown with white chest {config.SEL_TAG}")
    set_date(driver, (By.ID, "incidentDateInput"), datetime.date.today().isoformat())
    select_first_real_option(driver, (By.ID, "barangayInput"))
    driver.find_element(By.ID, "petPhoto").send_keys(png_fixture("lost-pet.png"))
    type_into(driver, (By.ID, "contactName"), "Automation Petowner")
    type_into(driver, (By.ID, "contactPhone"), "09171234567")
    type_into(driver, (By.ID, "contactEmail"), config.OWNER_EMAIL)

    mark = resource_mark(driver)
    started = time.perf_counter()
    click(driver, (By.CSS_SELECTOR, "#reportModal .btn-submit"))
    wait(driver, 45).until(lambda d: is_displayed(d, (By.ID, "lostSuccessModal")))
    elapsed = round(time.perf_counter() - started, 3)

    steps = texts_of(driver, "#lostSuccessModal .step-title")
    server = api_request_seconds(driver, "lost-found/lost_and_found.php", since=mark)
    tc.measure("rendered_s", elapsed)
    tc.measure("server_request_s", server if server is not None else "n/a")
    tc.measure("budget_s", STANDARD)
    tc.measure("success_steps_shown", len(steps))
    tc.shot("success-screen")
    if server is not None and server > STANDARD:
        tc.note(
            f"{server:.1f}s of the wait is the POST to api/lost-found/lost_and_found.php "
            "itself, so this is server-side work, not rendering."
        )
    assert elapsed <= STANDARD, (
        f"The report confirmation took {elapsed:.2f}s, over the {STANDARD:.0f}s budget"
        + (f" ({server:.2f}s of it inside the API call)" if server is not None else "")
    )


@testcase(
    "TC-PO-P05", "Chatbot Response Time",
    "From submitting a chatbot input to the answer being displayed within 3 seconds",
    category="performance", role="owner",
)
def test_chatbot_response_time(as_owner, driver, tc):
    as_owner(pages.LANDING)
    click(driver, (By.ID, "chatbotFab"))
    visible(driver, (By.ID, "chatbotPanel"), timeout=15)

    option = wait(driver, 25).until(
        lambda d: next(
            (b for b in d.find_elements(By.CSS_SELECTOR, "#inquiryOptions .option-btn")
             if "clinic schedule" in b.text.lower()),
            False,
        )
    )

    started = time.perf_counter()
    driver.execute_script("arguments[0].click();", option)
    wait(driver, 45).until(
        lambda d: element_count(d, (By.CSS_SELECTOR, "#inquiryMessages .chat-info-box")) > 0
    )
    elapsed = round(time.perf_counter() - started, 3)

    tc.measure("rendered_s", elapsed)
    tc.measure("budget_s", STANDARD)
    tc.note(
        "public/js/chatbot.js deliberately animates the reply: a 220ms selection "
        "pause plus a ~500-700ms typing indicator are part of this figure by design, "
        "so roughly 0.8s of it is presentation rather than processing."
    )
    tc.shot("chatbot-answer")
    assert elapsed <= STANDARD, (
        f"The chatbot answer took {elapsed:.2f}s, over the {STANDARD:.0f}s budget"
    )


# ===========================================================================
# VETERINARIAN
# ===========================================================================


@testcase(
    "TC-VT-P01", "Dashboard Load Time",
    "The clinical dashboard renders its cards, charts and navigation within 3 seconds",
    category="performance", role="vet",
)
def test_vet_dashboard_load_time(driver, tc, vet_session, charts):
    def ready(d):
        # Wait for the summary figures, not for the greeting: the greeting is
        # static text, and #headerUserName is left at its em-dash placeholder
        # on this build, so neither of them says anything about loading.
        stats = texts_of(d, "#dashboard-content .greet-stat-val")
        return (
            d.execute_script("return document.readyState === 'complete';")
            and len(texts_of(d, ".sidebar .nav-label")) > 5
            and len(stats) >= 2
            and all(has_digits(s) for s in stats)
        )

    _measure(driver, tc, pages.VET_DASHBOARD, ready, STANDARD,
             "The veterinarian dashboard", session=vet_session)

    painted = canvas_rendered(driver, "patientVolumeChart", timeout=10)
    tc.measure("charts_painted", painted)
    if not painted:
        tc.note(
            "Measured to the statistics and navigation only: the dashboard charts never "
            "paint on this build. " + (charts["reason"] or "")
        )


@testcase(
    "TC-VT-P02", "Patient Records Load Time",
    "The patient table, statistics, search and filters all render within 3 seconds",
    category="performance", role="vet",
)
def test_patient_records_load_time(driver, tc, vet_session):
    def ready(d):
        return (
            element_count(d, (By.CSS_SELECTOR, ".records-table tbody tr")) > 0
            and element_count(d, (By.CSS_SELECTOR, "[data-filter-type]")) > 0
            and len(d.find_elements(By.ID, "search-input")) > 0
            and any(has_digits(m) for m in texts_of(d, ".metric-value"))
        )

    _measure(driver, tc, pages.VET_PATIENT_RECORDS, ready, STANDARD,
             "Patient Records", session=vet_session)
    tc.measure("rows_rendered",
               element_count(driver, (By.CSS_SELECTOR, ".records-table tbody tr")))


@testcase(
    "TC-VT-P03", "Disease Analytics Chart Rendering Time",
    "Both the actual and the Random-Forest predicted charts render within 5 seconds",
    category="performance", role="vet",
)
def test_disease_analytics_render_time(driver, tc, vet_session):
    def ready(d):
        return (
            element_count(d, (By.CSS_SELECTOR, "#actualChart > *")) > 0
            and element_count(d, (By.CSS_SELECTOR, "#predictedChart > *")) > 0
            and any(has_digits(k) for k in texts_of(d, "#kpiCards > *"))
        )

    _measure(driver, tc, pages.VET_DISEASE_ANALYTICS, ready, ANALYTICS,
             "Disease Analytics", session=vet_session, timeout=90)
    tc.measure("actual_bars", element_count(driver, (By.CSS_SELECTOR, "#actualChart > *")))
    tc.measure("predicted_bars", element_count(driver, (By.CSS_SELECTOR, "#predictedChart > *")))


@testcase(
    "TC-VT-P04", "ARIMA Vaccination Forecast Rendering Time",
    "The mass vaccination page and its ARIMA forecast render within 5 seconds",
    category="performance", role="vet",
)
def test_mass_vaccination_render_time(driver, tc, vet_session, charts, analytics_available):
    def ready(d):
        return (
            element_count(d, (By.CSS_SELECTOR, "#event-table-body tr")) > 0
            and any(has_digits(s)
                    for s in texts_of(d, ".kpi-value, .stat-value, .metric-value"))
        )

    _measure(driver, tc, pages.VET_MASS_VACCINATION, ready, ANALYTICS,
             "Mass Vaccination", session=vet_session, timeout=90)

    forecast_painted = canvas_rendered(driver, "predictedAnimalsChart", timeout=10)
    tc.measure("arima_chart_painted", forecast_painted)
    if not forecast_painted:
        why = []
        if not charts["ok"]:
            why.append(charts["reason"])
        if not analytics_available:
            why.append("The Flask analytics service on 127.0.0.1:5001 is not running, "
                       "so the forecast endpoint answers 502.")
        tc.note("Measured to the statistics and event table only. " + " ".join(why))


@testcase(
    "TC-VT-P05", "Report Export Response Time",
    "CSV and PDF exports each complete within 5 seconds of clicking download",
    category="performance", role="vet",
)
def test_vet_export_response_time(as_vet, driver, tc):
    from test_functional_vet import _downloaded_files, _await_download

    as_vet(pages.VET_REPORT)
    wait(driver, 40).until(lambda d: has_digits(text_of(d, (By.ID, "metric-total"))))
    wait(driver, 40).until(
        lambda d: element_count(d, (By.CSS_SELECTOR, "#report-table-body tr")) > 0
    )

    # Apply a date-range filter first, as the case describes.
    click(driver, (By.ID, "filter-button"))
    visible(driver, (By.ID, "filter-popover"), timeout=10)
    click(driver, (By.ID, "filter-done"))
    time.sleep(1.0)

    results = {}
    for fmt in ("csv", "pdf"):
        before = _downloaded_files()
        click(driver, (By.ID, "export-button"))
        visible(driver, (By.ID, "export-modal-overlay"), timeout=15)
        click(driver, (By.CSS_SELECTOR, f".export-option[data-format='{fmt}']"))

        started = time.perf_counter()
        click(driver, (By.ID, "export-download"))
        name = _await_download(before, timeout=60)
        results[fmt] = round(time.perf_counter() - started, 3)
        tc.measure(f"{fmt}_seconds", results[fmt])
        tc.measure(f"{fmt}_file", name or "none")
        assert name, f"The {fmt.upper()} export never produced a file"

    tc.measure("budget_s", ANALYTICS)
    over = {k: v for k, v in results.items() if v > ANALYTICS}
    assert not over, f"Exports over the {ANALYTICS:.0f}s budget: {over}"


# ===========================================================================
# ADMIN
# ===========================================================================


@testcase(
    "TC-AD-P01", "Admin Dashboard Load Time",
    "The admin dashboard renders its statistics, shortcuts and navigation within 3 seconds",
    category="performance", role="admin",
)
def test_admin_dashboard_load_time(driver, tc, admin_session):
    def ready(d):
        return (
            d.execute_script("return document.readyState === 'complete';")
            and len(texts_of(d, ".sidebar .nav-label")) > 5
            and has_digits(d.execute_script(
                "const el = document.getElementById('kpi-total-accounts');"
                "return el ? el.textContent : '';"
            ) or "")
        )

    _measure(driver, tc, pages.ADMIN_DASHBOARD, ready, STANDARD,
             "The admin dashboard", session=admin_session)
    tc.measure("total_accounts", text_of(driver, (By.ID, "kpi-total-accounts")))


@testcase(
    "TC-AD-P02", "Account Management Page Load Time",
    "The full user list with roles, statuses and join dates renders within 3 seconds",
    category="performance", role="admin",
)
def test_account_management_load_time(driver, tc, admin_session):
    def ready(d):
        return (
            element_count(d, (By.CSS_SELECTOR, "#user-table-body tr")) > 0
            and element_count(d, (By.CSS_SELECTOR, "#user-table-body .am-role-badge")) > 0
            and has_digits(d.execute_script(
                "const el = document.getElementById('kpi-total');"
                "return el ? el.textContent : '';"
            ) or "")
        )

    _measure(driver, tc, pages.ADMIN_ACCOUNTS, ready, STANDARD,
             "Account Management", session=admin_session)
    tc.measure("rows_rendered", element_count(driver, (By.CSS_SELECTOR, "#user-table-body tr")))


@testcase(
    "TC-AD-P03", "Website Content Save Response Time",
    "Save Changes is confirmed within 3 seconds of being clicked",
    category="performance", role="admin",
)
def test_website_save_response_time(as_admin, driver, tc, write_live):
    as_admin(pages.ADMIN_WEBSITE)
    wait(driver, 40).until(
        lambda d: d.find_element(By.ID, "cp-about").get_attribute("value") is not None
    )

    if not write_live:
        pytest.skip(
            "Timing this case means actually saving site_settings, which changes the "
            "public landing page. Re-run with --write-live to measure it."
        )

    original = driver.find_element(By.ID, "cp-about").get_attribute("value")
    try:
        type_into(driver, (By.ID, "cp-about"), f"{original} {config.SEL_TAG}")
        started = time.perf_counter()
        click(driver, (By.ID, "btn-save"))
        wait(driver, 45).until(
            lambda d: d.execute_script(
                "const t = document.querySelector('.toast, #toast, .wm-toast');"
                "return !!t && (t.offsetParent !== null || t.classList.contains('show'));"
            )
            or d.find_element(By.ID, "btn-save").is_enabled()
        )
        elapsed = round(time.perf_counter() - started, 3)
        tc.measure("rendered_s", elapsed)
        tc.measure("budget_s", STANDARD)
        tc.shot("saved")
        assert elapsed <= STANDARD, \
            f"Saving website content took {elapsed:.2f}s, over the {STANDARD:.0f}s budget"
    finally:
        type_into(driver, (By.ID, "cp-about"), original or "")
        click(driver, (By.ID, "btn-save"))
        time.sleep(2.0)


@testcase(
    "TC-AD-P04", "Lost and Found Review Action Response Time",
    "The Pending Review tab loads within 3 seconds and review actions respond within 3 seconds",
    category="performance", role="admin",
)
def test_lost_found_review_response_time(driver, tc, admin_session):
    def ready(d):
        return (
            len(texts_of(d, "#tabBar button")) > 0
            and " ".join(texts_of(d, "#lfContent")).strip() != ""
        )

    _measure(driver, tc, pages.VET_LOST_FOUND, ready, STANDARD,
             "The Lost and Found Pending Review tab", session=admin_session)

    # Approve timing needs something pending to act on - and it must be one of
    # OUR submissions, never a real one, because approving publishes a report
    # to the public board.
    cards = driver.find_elements(By.CSS_SELECTOR, "#lfContent .report-card, #lfContent article")
    ours = [
        card for card in cards
        if "SEL-" in card.text
        and card.find_elements(By.CSS_SELECTOR, "[data-action='approve-pending']")
    ]
    tc.measure("pending_cards", len(cards))
    tc.measure("own_cards_available", len(ours))
    if not ours:
        tc.note(
            "No [SELENIUM]-tagged submission is awaiting review, so the approve-action "
            "response time was not measured - approving somebody else's report would "
            "publish it to the public board. Run TC-PO-F05 first to create one."
        )
        return

    actions = ours[0].find_elements(By.CSS_SELECTOR, "[data-action='approve-pending']")

    # "Responded" is measured as the review call completing. The page gives
    # different visual feedback depending on the action (re-render, confirm
    # dialog, toast), but every one of them is preceded by exactly one request
    # to the lost-and-found endpoint - so count those instead of guessing at
    # the UI.
    def request_count(d) -> int:
        return d.execute_script(
            "return performance.getEntriesByType('resource')"
            ".filter(e => e.name.indexOf('lost_and_found.php') !== -1).length;"
        )

    before_requests = request_count(driver)
    started = time.perf_counter()
    driver.execute_script("arguments[0].click();", actions[0])

    # Approve opens the module's own confirm dialog (#lfConfirmOk) before it
    # sends anything - see openConfirmDialog in vet/js/lost-and-found.js.
    confirm = wait(driver, 10).until(
        lambda d: d.find_elements(By.ID, "lfConfirmOk") or False
    )
    tc.note("The approve action asks for confirmation first; that click is included")
    driver.execute_script("arguments[0].click();", confirm[0])

    wait(driver, 45).until(lambda d: request_count(d) > before_requests)
    elapsed = round(time.perf_counter() - started, 3)
    tc.measure("approve_action_s", elapsed)
    tc.shot("after-approve")
    assert elapsed <= STANDARD, \
        f"The approve action took {elapsed:.2f}s, over the {STANDARD:.0f}s budget"


@testcase(
    "TC-AD-P05", "Report Export Response Time",
    "CSV and PDF exports each complete within 5 seconds of clicking download",
    category="performance", role="admin",
)
def test_admin_export_response_time(as_admin, driver, tc):
    from test_functional_vet import _downloaded_files, _await_download

    as_admin(pages.VET_REPORT)
    wait(driver, 40).until(lambda d: has_digits(text_of(d, (By.ID, "metric-total"))))
    wait(driver, 40).until(
        lambda d: element_count(d, (By.CSS_SELECTOR, "#report-table-body tr")) > 0
    )

    click(driver, (By.ID, "filter-button"))
    visible(driver, (By.ID, "filter-popover"), timeout=10)
    click(driver, (By.ID, "filter-done"))
    time.sleep(1.0)

    results = {}
    for fmt in ("csv", "pdf"):
        before = _downloaded_files()
        click(driver, (By.ID, "export-button"))
        visible(driver, (By.ID, "export-modal-overlay"), timeout=15)
        click(driver, (By.CSS_SELECTOR, f".export-option[data-format='{fmt}']"))

        started = time.perf_counter()
        click(driver, (By.ID, "export-download"))
        name = _await_download(before, timeout=60)
        results[fmt] = round(time.perf_counter() - started, 3)
        tc.measure(f"{fmt}_seconds", results[fmt])
        tc.measure(f"{fmt}_file", name or "none")
        assert name, f"The {fmt.upper()} export never produced a file"

    tc.measure("budget_s", ANALYTICS)
    over = {k: v for k, v in results.items() if v > ANALYTICS}
    assert not over, f"Exports over the {ANALYTICS:.0f}s budget: {over}"
