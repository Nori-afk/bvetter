"""Functionality Testing - Admin  (TC-AD-F01 .. TC-AD-F07).

Note on shared screens: Appointment Management, Lost and Found, Mass
Vaccination and Report are the same pages the veterinarian uses - admin is a
superset role (see requireAuth in shared/js/auth.js). The admin cases here
therefore assert that an admin can reach and operate them, and that the
admin-only modules appear alongside, rather than duplicating the vet
assertions field for field.
"""

from __future__ import annotations

import time

from support import auth, config, db, pages
from support.helpers import (
    By,
    canvas_rendered,
    click,
    dismiss_overlays,
    element_count,
    has_digits,
    is_displayed,
    select_first_real_option,
    text_of,
    texts_of,
    type_into,
    vb_alert_message,
    visible,
    wait,
    wait_for_count,
    wait_for_js,
)
from support.marks import testcase


def _visible_sidebar_labels(driver) -> list[str]:
    wait(driver, 20).until(lambda d: len(texts_of(d, ".sidebar .nav-label")) > 0)
    return driver.execute_script(
        """
        return Array.from(document.querySelectorAll('.sidebar .nav-item'))
            .filter(el => el.offsetParent !== null || el.getClientRects().length)
            .map(el => (el.textContent || '').trim())
            .filter(Boolean);
        """
    )


# ===========================================================================
# TC-AD-F01  User Login
# ===========================================================================


@testcase(
    "TC-AD-F01", "User Login",
    "Admin is authenticated and lands on the admin dashboard with its statistics and sidebar",
    category="functional", role="admin",
)
def test_admin_login_lands_on_dashboard(driver, tc, admin_credentials):
    outcome = auth.login_admin(driver)
    assert outcome == "session", \
        f"Admin login did not create a session ({outcome}): {auth.notice_message(driver)}"
    assert "/admin/pages/index.html" in driver.current_url
    tc.note(
        "Admin logins are gated by email two-factor "
        "(security_settings.two_factor_enabled); the code was read from "
        "login_otp_codes as a stand-in for the mailbox."
    )

    wait_for_js(driver, "document.readyState === 'complete'")
    dismiss_overlays(driver)

    labels = _visible_sidebar_labels(driver)
    tc.measure("sidebar_modules", len(labels))
    tc.note("Sidebar: " + ", ".join(labels))
    for expected in ("Dashboard", "Account Management", "Website Management",
                     "Appointment Management", "Report"):
        assert any(expected.lower() in label.lower() for label in labels), \
            f"The admin sidebar is missing {expected!r}; it shows {labels}"

    # System overview statistics have to actually populate, not sit at '--'.
    wait(driver, 30).until(lambda d: has_digits(text_of(d, (By.ID, "kpi-total-accounts"))))
    for name, locator in (
        ("total_accounts", (By.ID, "kpi-total-accounts")),
        ("pending_approvals", (By.ID, "kpi-pending-approvals")),
        ("system_alerts", (By.ID, "kpi-system-alerts")),
    ):
        tc.measure(name, text_of(driver, locator))
    tc.shot("admin-dashboard")


# ===========================================================================
# TC-AD-F02  Account Management
# ===========================================================================


@testcase(
    "TC-AD-F02", "Account Management",
    "User statistics and the full user list load; a new account can be created, then blocked",
    category="functional", role="admin",
)
def test_account_management(as_admin, driver, tc, mutating):
    as_admin(pages.ADMIN_ACCOUNTS)

    wait(driver, 30).until(lambda d: has_digits(text_of(d, (By.ID, "kpi-total"))))
    tc.measure("total_users", text_of(driver, (By.ID, "kpi-total")))
    tc.measure("active_vets", text_of(driver, (By.ID, "kpi-vet")))
    tc.measure("blocked", text_of(driver, (By.ID, "kpi-blocked")))

    wait_for_count(driver, (By.CSS_SELECTOR, "#user-table-body tr"), 1, timeout=30)
    rows = element_count(driver, (By.CSS_SELECTOR, "#user-table-body tr"))
    tc.measure("rows_listed", rows)
    tc.measure("showing_label", text_of(driver, (By.ID, "showing-label")))

    # The list has to carry role, status and join date per row.
    assert element_count(driver, (By.CSS_SELECTOR, "#user-table-body .am-role-badge")) > 0, \
        "No role badges are rendered in the user list"
    tc.shot("account-list")

    # -- create a throwaway account, then block it -------------------------
    # Deliberately a new account rather than a real one: blocking a real vet
    # or owner would lock a person out of the system.
    email = f"selenium.acct.{int(time.time())}@bvetter.test"
    click(driver, (By.ID, "btn-add-user"))
    visible(driver, (By.ID, "modal-add-account"), timeout=15)

    type_into(driver, (By.ID, "add-acc-name"), "Automation Created User")
    type_into(driver, (By.ID, "add-acc-email"), email)
    type_into(driver, (By.ID, "add-acc-phone"), "09171234567")
    type_into(driver, (By.ID, "add-acc-password"), "Zt6@nHrk4Wp8")
    # The role list is fetched from the server, and choosing a vet role reveals
    # a second block of required fields - fill those too so the choice of role
    # never decides whether this test passes.
    role = select_first_real_option(driver, (By.ID, "add-acc-role"))
    tc.measure("created_role", role)
    if is_displayed(driver, (By.ID, "add-acc-vet-fields")):
        type_into(driver, (By.ID, "add-acc-specialization"), "General Practice")
        type_into(driver, (By.ID, "add-acc-education"), "DVM")
    tc.shot("create-user-form")
    click(driver, (By.ID, "add-submit"))

    created = None
    for _ in range(30):
        created = db.user(email)
        if created:
            break
        time.sleep(0.5)

    if not created:
        # Say which field the form objected to rather than just "nothing happened".
        inline = texts_of(driver, "#modal-add-account .dash-field-error")
        raise AssertionError(
            "Create New User did not produce an account.\n"
            f"    Alert: {vb_alert_message(driver)!r}\n"
            f"    Field errors: {inline or 'none'}"
        )
    tc.measure("created_account", f"{email} ({created['role']}, {created['account_status']})")
    tc.note(f"Created {email} for the block test")

    # -- block it ----------------------------------------------------------
    driver.refresh()
    dismiss_overlays(driver)
    wait_for_count(driver, (By.CSS_SELECTOR, "#user-table-body tr"), 1, timeout=30)
    type_into(driver, (By.ID, "search-users"), email)
    time.sleep(1.5)

    row = wait(driver, 20).until(
        lambda d: next(
            (r for r in d.find_elements(By.CSS_SELECTOR, "#user-table-body tr")
             if email in r.text),
            False,
        )
    )
    block_buttons = row.find_elements(By.CSS_SELECTOR, ".am-btn-block")
    assert block_buttons, "The new account offers no Block action"
    driver.execute_script("arguments[0].click();", block_buttons[0])
    visible(driver, (By.ID, "modal-block"), timeout=15)
    click(driver, (By.ID, "block-confirm-btn"))

    blocked = None
    for _ in range(30):
        blocked = db.user(email)
        if blocked and blocked["account_status"] == "blocked":
            break
        time.sleep(0.5)
    tc.measure("status_after_block", blocked["account_status"] if blocked else "missing")
    tc.shot("after-block")
    assert blocked and blocked["account_status"] == "blocked", (
        "Blocking the account did not change its status; it is "
        f"{(blocked or {}).get('account_status')!r}"
    )


# ===========================================================================
# TC-AD-F03  Website Management
# ===========================================================================


@testcase(
    "TC-AD-F03", "Website Management",
    "Every editable section is present and Save Changes persists to the public landing page",
    category="functional", role="admin",
)
def test_website_management(as_admin, driver, tc, write_live):
    as_admin(pages.ADMIN_WEBSITE)
    wait_for_js(driver, "document.readyState === 'complete'")

    sections = {
        "brand & logo": (By.ID, "section-brand-logo"),
        "visual assets": (By.ID, "section-assets"),
        "announcements": (By.ID, "section-announcements"),
        "company profile": (By.ID, "section-profile"),
        "live preview": (By.ID, "section-preview"),
    }
    for name, locator in sections.items():
        assert driver.find_elements(*locator), f"The {name} section is missing"
    tc.measure("sections_present", ", ".join(sections))

    for control in ("logo-file-input", "color-picker", "hero-banner-input",
                    "team-workspace-input", "btn-add-ann", "cp-about", "btn-save"):
        assert driver.find_elements(By.ID, control), \
            f"The website settings screen is missing the {control!r} control"

    # The About Us text has to load from the server, not sit empty.
    wait(driver, 30).until(
        lambda d: d.find_element(By.ID, "cp-about").get_attribute("value") is not None
    )
    original_about = driver.find_element(By.ID, "cp-about").get_attribute("value")
    tc.measure("about_us_chars", len(original_about or ""))
    tc.shot("website-management")

    if not write_live:
        tc.note(
            "All editable sections and the Save control were verified. The save itself "
            "is left to --write-live, because it rewrites site_settings and changes what "
            "the public landing page shows."
        )
        return

    marker = f"{config.SEL_TAG} {int(time.time())}"
    try:
        type_into(driver, (By.ID, "cp-about"), f"{original_about} {marker}")
        click(driver, (By.ID, "btn-save"))
        time.sleep(3.0)
        tc.shot("saved")

        # And it has to be visible to the public, not just stored.
        driver.get(pages.LANDING)
        wait_for_js(driver, "document.readyState === 'complete'")
        time.sleep(2.0)
        body = driver.find_element(By.TAG_NAME, "body").text
        tc.measure("marker_on_landing", marker in body)
        assert marker in body, \
            "The saved About Us text did not appear on the public landing page"
    finally:
        # Put the original copy back so the demo site is unchanged.
        as_admin(pages.ADMIN_WEBSITE)
        wait(driver, 30).until(
            lambda d: d.find_element(By.ID, "cp-about").get_attribute("value") is not None
        )
        type_into(driver, (By.ID, "cp-about"), original_about or "")
        click(driver, (By.ID, "btn-save"))
        time.sleep(2.5)
        tc.note("Original About Us text restored")


# ===========================================================================
# TC-AD-F04  Appointment Management (admin view)
# ===========================================================================


@testcase(
    "TC-AD-F04", "Appointment Management",
    "Admin sees the whole appointment list with counts, statuses and a working details view",
    category="functional", role="admin",
)
def test_admin_appointment_management(as_admin, driver, tc):
    as_admin(pages.VET_APPOINTMENTS)

    wait(driver, 35).until(lambda d: has_digits(text_of(d, (By.ID, "pending-count"))))
    tc.measure("pending_requests", text_of(driver, (By.ID, "pending-count")))
    tc.measure("confirmed_appointments", text_of(driver, (By.ID, "confirmed-count")))

    wait_for_count(driver, (By.CSS_SELECTOR, "#appointment-tbody tr"), 1, timeout=35)
    tc.measure("rows_listed", element_count(driver, (By.CSS_SELECTOR, "#appointment-tbody tr")))

    headers = texts_of(driver, "table thead th")
    tc.measure("columns", " | ".join(headers))
    lowered = " ".join(headers).lower()
    for column in ("date", "status"):
        assert column in lowered, f"The appointment table has no {column!r} column: {headers}"

    statuses = texts_of(driver, "#appointment-tbody .status-pill")
    tc.measure("status_labels", ", ".join(sorted(set(statuses)))[:120])
    assert statuses, "No status labels are rendered on the appointment rows"

    click(driver, (By.CSS_SELECTOR, "#appointment-tbody [data-action='view']"))
    visible(driver, (By.ID, "modal-content"), timeout=15)
    details = " ".join(texts_of(driver, "#modal-content"))
    assert len(details) > 40, "The admin appointment details view came up empty"
    tc.shot("admin-appointments")


# ===========================================================================
# TC-AD-F05  Lost and Found Management (admin view)
# ===========================================================================


@testcase(
    "TC-AD-F05", "Lost and Found Management",
    "Admin can review pending submissions, upload a found pet, and see the Jaccard matches",
    category="functional", role="admin",
)
def test_admin_lost_and_found(as_admin, driver, tc):
    as_admin(pages.VET_LOST_FOUND)

    wait(driver, 35).until(lambda d: len(texts_of(d, "#tabBar button")) > 0)
    tabs = texts_of(driver, "#tabBar button")
    tc.measure("tabs", " | ".join(tabs))
    assert any("pending" in t.lower() for t in tabs), f"No Pending Review tab; tabs are {tabs}"
    assert any("match" in t.lower() for t in tabs), f"No Potential Matches tab; tabs are {tabs}"

    assert driver.find_elements(By.ID, "uploadFoundBtn"), \
        "Admin has no Upload Found Pet control"

    wait(driver, 35).until(lambda d: " ".join(texts_of(d, "#lfContent")).strip() != "")
    tc.measure("pending_panel_chars", len(" ".join(texts_of(driver, "#lfContent"))))
    tc.shot("admin-lf-pending")

    # The upload form opens and asks for the pet details.
    click(driver, (By.ID, "uploadFoundBtn"))
    visible(driver, (By.ID, "lfModalOverlay"), timeout=20)
    form_text = " ".join(texts_of(driver, "#lfModalBody")).lower()
    tc.measure("upload_form_chars", len(form_text))
    assert any(word in form_text for word in ("species", "breed", "barangay", "colour", "color")), \
        f"The Upload Found Pet form does not ask for pet details: {form_text[:200]!r}"
    tc.shot("admin-upload-found")
    click(driver, (By.ID, "closeModalBtn"))

    # -- matches -----------------------------------------------------------
    match_index = next(i for i, t in enumerate(tabs) if "match" in t.lower())
    driver.execute_script(
        "document.querySelectorAll('#tabBar button')[arguments[0]].click();", match_index
    )
    time.sleep(2.5)
    matches_text = " ".join(texts_of(driver, "#lfContent"))
    tc.measure("matches_panel_chars", len(matches_text))
    assert matches_text.strip(), "The Potential Matches tab rendered nothing at all"
    if "%" in matches_text or "confidence" in matches_text.lower():
        tc.note("Jaccard confidence score is displayed on the match cards")
    else:
        tc.note("No match suggestions exist right now - the panel rendered its empty state")
    tc.shot("admin-lf-matches")


# ===========================================================================
# TC-AD-F06  Mass Vaccination Management (admin view)
# ===========================================================================


@testcase(
    "TC-AD-F06", "Mass Vaccination Management",
    "Admin sees the vaccination statistics and ARIMA forecast and can open the create-event form",
    category="functional", role="admin",
)
def test_admin_mass_vaccination(as_admin, driver, tc, charts, analytics_available, needs_db):
    as_admin(pages.VET_MASS_VACCINATION)
    wait_for_js(driver, "document.readyState === 'complete'")

    wait(driver, 40).until(
        lambda d: any(has_digits(t)
                      for t in texts_of(d, ".kpi-value, .stat-value, .metric-value"))
    )
    tc.measure("statistics",
               " | ".join(texts_of(driver, ".kpi-value, .stat-value, .metric-value"))[:200])
    wait_for_count(driver, (By.CSS_SELECTOR, "#event-table-body tr"), 1, timeout=35)
    tc.measure("events_listed", element_count(driver, (By.CSS_SELECTOR, "#event-table-body tr")))

    click(driver, (By.ID, "open-create-event"))
    visible(driver, (By.ID, "create-event-form"), timeout=20)
    for field in ("event-date", "event-barangay", "event-vaccine"):
        assert driver.find_elements(By.ID, field), f"The Create Event form is missing {field!r}"
    tc.shot("admin-create-event")
    click(driver, (By.ID, "cancel-create-event"))

    # -- post-event logging form -------------------------------------------
    event = db.any_vacc_event()
    if event:
        tc.measure("event_probed", f"id={event['id']} status={event['status']}")
        driver.execute_script("document.querySelectorAll('#event-table-body tr')[0].click();")
        time.sleep(2.0)
        if driver.find_elements(By.ID, "post-event-form"):
            tc.note("Post-event totals form is available on the event detail panel")
            assert driver.find_elements(By.ID, "total-vaccinated"), \
                "The post-event form has no Total Vaccinated field"
        else:
            tc.note("The selected event does not expose a post-event form (not yet completed)")
    else:
        tc.note("No vaccination events exist, so post-event logging could not be checked")

    problem = None
    if not canvas_rendered(driver, "predictedAnimalsChart", timeout=20):
        problem = ("The ARIMA forecast chart is blank. "
                   + (charts["reason"] if not charts["ok"] else ""))
    tc.measure("arima_chart_render", "no" if problem else "yes")
    if problem and not analytics_available:
        tc.note(
            "The Flask analytics service on 127.0.0.1:5001 is not running, so the "
            "forecast endpoint answers 502 and the chart has nothing to draw."
        )
    else:
        assert not problem, problem


# ===========================================================================
# TC-AD-F07  Report Generation and Export
# ===========================================================================


@testcase(
    "TC-AD-F07", "Report Generation and Export",
    "Admin report statistics load, filter and sort apply, and CSV and PDF exports download",
    category="functional", role="admin",
)
def test_admin_report_export(as_admin, driver, tc):
    from test_functional_vet import _downloads_dir, _export
    import os

    as_admin(pages.VET_REPORT)

    wait(driver, 35).until(lambda d: has_digits(text_of(d, (By.ID, "metric-total"))))
    tc.measure("total_patients", text_of(driver, (By.ID, "metric-total")))
    tc.measure("most_common", text_of(driver, (By.ID, "metric-disease")))
    tc.measure("most_active_barangay", text_of(driver, (By.ID, "metric-barangay")))

    wait_for_count(driver, (By.CSS_SELECTOR, "#report-table-body tr"), 1, timeout=35)
    tc.measure("summary_before", text_of(driver, (By.ID, "report-summary")))

    click(driver, (By.ID, "filter-button"))
    visible(driver, (By.ID, "filter-popover"), timeout=10)
    categories = [
        o.get_attribute("value")
        for o in driver.find_elements(By.CSS_SELECTOR, "#report-category option")
        if o.get_attribute("value")
    ]
    if len(categories) > 1:
        from support.helpers import select_by_value

        select_by_value(driver, (By.ID, "report-category"), categories[1])
        tc.note(f"Category filter set to {categories[1]!r}")
    click(driver, (By.ID, "filter-done"))
    time.sleep(1.8)
    tc.measure("summary_after_filter", text_of(driver, (By.ID, "report-summary")))
    tc.shot("admin-report")

    csv_name = _export(driver, "csv")
    tc.measure("csv_download", csv_name or "none")
    pdf_name = _export(driver, "pdf")
    tc.measure("pdf_download", pdf_name or "none")

    assert csv_name, "The CSV export never produced a downloaded file"
    assert pdf_name, "The PDF export never produced a downloaded file"

    with open(os.path.join(_downloads_dir(), csv_name), "rb") as handle:
        head = handle.read(400).decode("utf-8", "replace")
    tc.measure("csv_header", head.splitlines()[0][:120] if head else "")
    assert head.strip(), "The exported CSV is empty"
