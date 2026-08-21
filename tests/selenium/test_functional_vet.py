"""Functionality Testing - Veterinarian  (TC-VT-F01 .. TC-VT-F08)."""

from __future__ import annotations

import os
import time

import pytest

from support import auth, config, db, flows, pages
from support.helpers import (
    By,
    canvas_rendered,
    click,
    dismiss_overlays,
    element_count,
    has_digits,
    is_displayed,
    select_by_value,
    set_date,
    text_of,
    texts_of,
    type_into,
    visible,
    wait,
    wait_for_count,
    wait_for_js,
)
from support.marks import testcase


def _visible_sidebar_labels(driver) -> list[str]:
    """Sidebar entries the user can actually see.

    Admin-only items stay in the DOM for every role and are hidden with CSS
    (see applyRoleVisibility in shared/js/sidebar.js), so presence in the
    markup proves nothing - offsetParent does.
    """
    wait(driver, 20).until(
        lambda d: len(texts_of(d, ".sidebar .nav-label")) > 0
    )
    return driver.execute_script(
        """
        return Array.from(document.querySelectorAll('.sidebar .nav-item'))
            .filter(el => el.offsetParent !== null || el.getClientRects().length)
            .map(el => (el.textContent || '').trim())
            .filter(Boolean);
        """
    )


def _chart_problem(driver, canvas_id: str, charts: dict, label: str) -> str | None:
    """Returns a description of why `canvas_id` is blank, or None if it drew."""
    if canvas_rendered(driver, canvas_id, timeout=25):
        return None
    if not charts["ok"]:
        return f"{label} is blank because Chart.js never loaded. {charts['reason']}"
    return f"{label} is blank even though Chart.js loaded."


# ===========================================================================
# TC-VT-F01  User Login
# ===========================================================================


@testcase(
    "TC-VT-F01", "User Login",
    "Vet is authenticated and lands on the clinical dashboard with its charts and sidebar",
    category="functional", role="vet",
)
def test_vet_login_lands_on_dashboard(driver, tc, charts, vet_credentials):
    outcome = auth.login_vet(driver)
    assert outcome == "session", \
        f"Vet login did not create a session ({outcome}): {auth.notice_message(driver)}"
    assert "/vet/html/index.html" in driver.current_url

    wait_for_js(driver, "document.readyState === 'complete'")
    dismiss_overlays(driver)

    labels = _visible_sidebar_labels(driver)
    tc.measure("sidebar_modules", len(labels))
    tc.note("Sidebar: " + ", ".join(labels))
    for expected in ("Dashboard", "Appointment Management", "Patient Records",
                     "Disease Analytics", "Mass Vaccination", "Chatbot Management",
                     "Report"):
        assert any(expected.lower() in label.lower() for label in labels), \
            f"Sidebar is missing {expected!r}; it shows {labels}"
    assert any("lost and found" in label.lower() for label in labels), \
        f"Sidebar is missing Lost and Found; it shows {labels}"

    # A vet must NOT be offered the admin-only modules.
    for forbidden in ("Account Management", "Website Management"):
        assert not any(forbidden.lower() in label.lower() for label in labels), \
            f"{forbidden!r} should be hidden from a veterinarian, but the sidebar shows it"

    tc.measure("greeting", text_of(driver, (By.ID, "greeting-name"), timeout=20))
    tc.shot("dashboard")

    problem = _chart_problem(driver, "patientVolumeChart", charts,
                             "The patient volume forecast chart")
    tc.measure("charts_render", "no" if problem else "yes")
    assert not problem, problem


# ===========================================================================
# TC-VT-F02  Appointment Management
# ===========================================================================


@testcase(
    "TC-VT-F02", "Appointment Management",
    "Pending and confirmed appointments are listed, details open, and Accept changes the status",
    category="functional", role="vet",
)
def test_appointment_management(as_owner, as_vet, driver, tc, mutating):
    # Give the vet something of ours to act on, so the test never touches a
    # real clinic booking - and book it WITH this vet, because the pending list
    # is filtered by veterinarian_id.
    as_owner(pages.BOOK_APPOINTMENT)
    booking = flows.book_appointment(driver, vet_name="Automation")
    tc.measure("booked_with_vet", booking["vet"] or "clinic default")
    tc.note(f"Created a pending appointment for {booking['pet_name']} to act on")
    if not booking["vet"]:
        pytest.skip(
            "The seeded veterinarian is not offered on the booking page, so a pending "
            "appointment cannot be routed to them. Check veterinarian_profiles.is_bookable "
            "for selenium.vet@bvetter.test."
        )

    as_vet(pages.VET_APPOINTMENTS)
    wait(driver, 30).until(lambda d: has_digits(text_of(d, (By.ID, "pending-count"))))
    pending_before = int(text_of(driver, (By.ID, "pending-count")) or 0)
    confirmed_before = int(text_of(driver, (By.ID, "confirmed-count")) or 0)
    tc.measure("pending_before", pending_before)
    tc.measure("confirmed_before", confirmed_before)
    assert pending_before >= 1, "The appointment just booked should be counted as pending"

    assert driver.find_elements(By.ID, "calendar"), "The calendar overview is missing"

    wait_for_count(driver, (By.CSS_SELECTOR, "#appointment-tbody tr"), 1, timeout=30)
    tc.measure("rows_listed", element_count(driver, (By.CSS_SELECTOR, "#appointment-tbody tr")))

    # -- details modal -----------------------------------------------------
    click(driver, (By.CSS_SELECTOR, "#appointment-tbody [data-action='view']"))
    visible(driver, (By.ID, "modal-content"), timeout=15)
    details = " ".join(texts_of(driver, "#modal-content"))
    tc.shot("details-modal")
    assert len(details) > 40, "The appointment details modal came up empty"
    lowered = details.lower()
    assert any(word in lowered for word in ("owner", "contact", "pet", "patient")), (
        f"The details modal should show patient and owner information; it showed {details[:200]!r}"
    )
    click(driver, (By.ID, "modal-close"))

    # -- accept OUR pending appointment ------------------------------------
    card = wait(driver, 25).until(
        lambda d: next(
            (c for c in d.find_elements(By.CSS_SELECTOR, ".pending-item")
             if booking["pet_name"] in c.text),
            False,
        )
    )
    appointment_id = card.get_attribute("data-id")
    accept = card.find_element(By.CSS_SELECTOR, "[data-action='accept']")
    driver.execute_script("arguments[0].click();", accept)

    wait(driver, 30).until(
        lambda d: int(text_of(d, (By.ID, "confirmed-count")) or 0) > confirmed_before
        or int(text_of(d, (By.ID, "pending-count")) or 0) < pending_before
    )
    tc.measure("pending_after", text_of(driver, (By.ID, "pending-count")))
    tc.measure("confirmed_after", text_of(driver, (By.ID, "confirmed-count")))
    tc.shot("after-accept")

    stored = db.latest_appointment(config.OWNER_EMAIL)
    tc.measure("stored_status", stored["status"])
    assert str(stored["id"]) == appointment_id, "Acted on a different appointment than expected"
    assert stored["status"] == "confirmed", \
        f"Accept should move the appointment to confirmed; it is {stored['status']!r}"


# ===========================================================================
# TC-VT-F03  Patient Records Management
# ===========================================================================


@testcase(
    "TC-VT-F03", "Patient Records Management",
    "Patient list, statistics, search and species filters work; the new-patient form is complete",
    category="functional", role="vet",
)
def test_patient_records_search_and_filter(as_vet, driver, tc, write_live):
    as_vet(pages.VET_PATIENT_RECORDS)

    wait_for_count(driver, (By.CSS_SELECTOR, ".records-table tbody tr"), 1, timeout=40)
    metrics = texts_of(driver, ".metric-card")
    tc.measure("metric_cards", " | ".join(m.replace("\n", " ") for m in metrics)[:220])
    assert metrics and any(has_digits(m) for m in metrics), \
        "The patient-records statistic cards did not populate"

    rows_all = element_count(driver, (By.CSS_SELECTOR, ".records-table tbody tr"))
    tc.measure("rows_unfiltered", rows_all)

    # -- search ------------------------------------------------------------
    first_cell = texts_of(driver, ".records-table tbody tr td")[0]
    needle = first_cell.split("\n")[0][:6].strip()
    type_into(driver, (By.ID, "search-input"), needle)
    time.sleep(1.5)  # filters as you type, with no spinner to wait on
    rows_search = element_count(driver, (By.CSS_SELECTOR, ".records-table tbody tr"))
    tc.measure("search_term", needle)
    tc.measure("rows_after_search", rows_search)
    body = " ".join(texts_of(driver, ".records-table tbody")).lower()
    assert needle.lower() in body or rows_search == 0, \
        f"Searching for {needle!r} returned rows that do not contain it"

    type_into(driver, (By.ID, "search-input"), "")
    time.sleep(1.2)

    # -- species filters ---------------------------------------------------
    counts = {}
    for species in ("canine", "feline", "all"):
        click(driver, (By.CSS_SELECTOR, f"[data-filter-type='{species}']"))
        time.sleep(1.2)
        counts[species] = element_count(driver, (By.CSS_SELECTOR, ".records-table tbody tr"))
    tc.measure("rows_by_filter", ", ".join(f"{k}={v}" for k, v in counts.items()))
    assert counts["all"] >= max(counts["canine"], counts["feline"]), \
        f"A species filter returned more rows than the unfiltered list: {counts}"
    tc.shot("patient-records")

    # -- Add New Patient ---------------------------------------------------
    click(driver, (By.CSS_SELECTOR, "[data-nav='add']"))
    visible(driver, (By.ID, "record-form"), timeout=25)

    # Pet fields live inside repeatable entries and are addressed by
    # data-field, not by id (see renderPetEntryFields).
    for field in ("petName", "species", "breed", "sex"):
        assert driver.find_elements(By.CSS_SELECTOR, f"[data-pet-entry] [data-field='{field}']"), \
            f"The new-patient form is missing the pet {field!r} field"
    for field in ("owner-name", "phone", "visit-date", "diagnosis", "symptoms"):
        assert driver.find_elements(By.ID, field), \
            f"The new-patient form is missing the {field!r} field"
    tc.shot("add-patient-form")
    tc.note("New-patient form exposes pet, owner and visit-log sections")

    if not write_live:
        tc.note(
            "Form opened and validated; saving is left to --write-live. A saved "
            "patient/visit row lands in patient_visit_records, which is the dataset the "
            "disease analytics and the thesis figures are computed from."
        )
        return

    pet_name = f"SEL-{int(time.time()) % 100000}"
    type_into(driver, (By.CSS_SELECTOR, "[data-pet-entry] [data-field='petName']"), pet_name)
    type_into(driver, (By.CSS_SELECTOR, "[data-pet-entry] [data-field='breed']"), "Aspin")
    type_into(driver, (By.ID, "owner-name"), "Automation Owner")
    type_into(driver, (By.ID, "phone"), "09171234567")
    set_date(driver, (By.ID, "visit-date"), time.strftime("%Y-%m-%d"))
    type_into(driver, (By.ID, "symptoms"), f"{config.SEL_TAG} automated visit log")
    click(driver, (By.CSS_SELECTOR,
                   "#record-form button[type='submit'], #record-form .btn-primary"))
    time.sleep(2.5)
    tc.note(f"Saved patient {pet_name}")
    tc.shot("patient-saved")


# ===========================================================================
# TC-VT-F04  Disease Analytics and Prediction
# ===========================================================================


@testcase(
    "TC-VT-F04", "Disease Analytics and Prediction",
    "Overview statistics, actual and Random-Forest predicted per-barangay charts, and the risk map",
    category="functional", role="vet",
)
def test_disease_analytics(as_vet, driver, tc, charts):
    as_vet(pages.VET_DISEASE_ANALYTICS)

    wait(driver, 45).until(lambda d: any(has_digits(t) for t in texts_of(d, "#kpiCards > *")))
    kpis = texts_of(driver, "#kpiCards > *")
    tc.measure("overview_cards", " | ".join(k.replace("\n", " ") for k in kpis)[:260])
    assert any(has_digits(k) for k in kpis), \
        f"The disease-analytics overview cards did not populate: {kpis}"

    # Both bar charts are DOM-built (not canvas), so count their bars.
    wait_for_count(driver, (By.CSS_SELECTOR, "#actualChart > *"), 1, timeout=45)
    actual_bars = element_count(driver, (By.CSS_SELECTOR, "#actualChart > *"))
    predicted_bars = element_count(driver, (By.CSS_SELECTOR, "#predictedChart > *"))
    tc.measure("actual_bars", actual_bars)
    tc.measure("predicted_bars", predicted_bars)
    assert actual_bars > 0, "The Actual Disease Cases per Barangay chart rendered no bars"
    assert predicted_bars > 0, (
        "The Random Forest Predicted Disease Cases chart rendered no bars - "
        "the prediction layer produced nothing to plot"
    )
    tc.shot("analytics-overview")

    # -- disease filter changes what is plotted ---------------------------
    values = [
        o.get_attribute("value")
        for o in driver.find_elements(By.CSS_SELECTOR, "#diseaseFilter option")
        if o.get_attribute("value")
    ]
    tc.measure("disease_options", len(values))
    assert len(values) > 1, "The disease filter offers nothing to filter by"

    before = " ".join(texts_of(driver, "#actualChart"))
    select_by_value(driver, (By.ID, "diseaseFilter"), values[1])
    time.sleep(2.5)
    after = " ".join(texts_of(driver, "#actualChart"))
    tc.note(f"Filtered to {values[1]!r}")
    assert after.strip(), "Selecting a disease emptied the actual-cases chart"
    tc.measure("chart_changed_on_filter", "yes" if after != before else "no")

    # -- detailed risk map -------------------------------------------------
    click(driver, (By.ID, "openMapBtn"))
    wait(driver, 25).until(
        lambda d: "panel-active" in d.find_element(By.ID, "mapPanel").get_attribute("class")
        or is_displayed(d, (By.ID, "baliwagMap"))
    )
    tc.shot("risk-map")

    leaflet_ready = driver.execute_script("return typeof window.L !== 'undefined';")
    tc.measure("leaflet_loaded", leaflet_ready)
    if not leaflet_ready:
        assert charts["ok"], (
            "The barangay risk map cannot draw because Leaflet never loaded. "
            f"{charts['reason']}"
        )
        raise AssertionError("Leaflet loaded elsewhere but not on the disease analytics page")

    wait(driver, 30).until(
        lambda d: element_count(d, (By.CSS_SELECTOR, "#baliwagMap .leaflet-pane")) > 0
    )
    tc.note("Leaflet risk map rendered its layers")


# ===========================================================================
# TC-VT-F05  Mass Vaccination and ARIMA forecast
# ===========================================================================


@testcase(
    "TC-VT-F05", "Mass Vaccination and ARIMA Forecast",
    "Vaccination statistics, the per-barangay chart and the ARIMA forecast render; events can be created",
    category="functional", role="vet",
)
def test_mass_vaccination(as_vet, driver, tc, charts, analytics_available, write_live):
    as_vet(pages.VET_MASS_VACCINATION)
    wait_for_js(driver, "document.readyState === 'complete'")

    wait(driver, 40).until(
        lambda d: any(has_digits(t) for t in texts_of(d, ".kpi-value, .stat-value, .metric-value"))
    )
    stats = texts_of(driver, ".kpi-value, .stat-value, .metric-value")
    tc.measure("statistics", " | ".join(s.replace("\n", " ") for s in stats)[:220])

    wait_for_count(driver, (By.CSS_SELECTOR, "#event-table-body tr"), 1, timeout=35)
    tc.measure("events_listed", element_count(driver, (By.CSS_SELECTOR, "#event-table-body tr")))
    tc.shot("mass-vaccination")

    # -- Create New Event form --------------------------------------------
    click(driver, (By.ID, "open-create-event"))
    visible(driver, (By.ID, "create-event-form"), timeout=20)
    for field in ("event-date", "event-barangay", "event-vaccine"):
        assert driver.find_elements(By.ID, field), f"The Create Event form is missing {field!r}"
    tc.shot("create-event-form")

    if write_live:
        set_date(driver, (By.ID, "event-date"), flows.next_weekday(21))
        driver.execute_script(
            "for (const id of ['event-barangay','event-vaccine']) {"
            "  const s = document.getElementById(id);"
            "  s.selectedIndex = 1; s.dispatchEvent(new Event('change', {bubbles:true}));"
            "}"
        )
        click(driver, (By.CSS_SELECTOR,
                       "#create-event-form button[type='submit'], #create-event-modal .btn-primary"))
        time.sleep(2.5)
        tc.note("Created a vaccination event")
        tc.shot("event-created")
    else:
        tc.note(
            "Create-event form opened and validated; saving is left to --write-live, "
            "because a new event changes the series the ARIMA forecast is fitted on."
        )
        driver.refresh()
        dismiss_overlays(driver)

    # -- charts last, so everything above is verified either way -----------
    problems = []
    actual = _chart_problem(driver, "vaccinatedPerBarangayChart", charts,
                            "The Pets Vaccinated per Barangay chart")
    if actual:
        problems.append(actual)
    tc.measure("actual_chart_render", "no" if actual else "yes")

    forecast = _chart_problem(driver, "predictedAnimalsChart", charts,
                              "The ARIMA predicted-vaccinations chart")
    tc.measure("arima_chart_render", "no" if forecast else "yes")
    if forecast:
        if not analytics_available:
            tc.note(
                "The ARIMA forecast has no data either way: the Flask analytics service on "
                "127.0.0.1:5001 is not running, so /api/dashboard/dashboard.php"
                "?scope=vaccination_forecast answers 502. Start it with "
                "`py api/analytics/arima_service.py`."
            )
        else:
            problems.append(forecast)

    assert not problems, "\n".join(problems)


# ===========================================================================
# TC-VT-F06  Lost and Found Management
# ===========================================================================


@testcase(
    "TC-VT-F06", "Lost and Found Management",
    "Pending submissions are listed for review and the Jaccard match suggestions are shown",
    category="functional", role="vet",
)
def test_vet_lost_and_found(as_vet, driver, tc):
    as_vet(pages.VET_LOST_FOUND)

    wait(driver, 35).until(lambda d: len(texts_of(d, "#tabBar button")) > 0)
    tabs = texts_of(driver, "#tabBar button")
    tc.measure("tabs", " | ".join(tabs))
    assert any("pending" in t.lower() for t in tabs), f"No Pending Review tab; tabs are {tabs}"
    assert any("match" in t.lower() for t in tabs), f"No Potential Matches tab; tabs are {tabs}"

    wait(driver, 35).until(lambda d: " ".join(texts_of(d, "#lfContent")).strip() != "")
    pending_text = " ".join(texts_of(driver, "#lfContent"))
    tc.measure("pending_panel_chars", len(pending_text))
    tc.shot("pending-review")

    actions = driver.find_elements(
        By.XPATH,
        "//*[@id='lfContent']//button[contains(translate(., 'APROVEJCT', 'aprovejct'), 'approve')"
        " or contains(translate(., 'REJCT', 'rejct'), 'reject')]",
    )
    tc.measure("review_actions_present", len(actions))
    if not actions:
        tc.note("Nothing is awaiting review right now, so no approve/reject buttons are drawn")

    # -- Potential Matches tab --------------------------------------------
    # Re-query by index: clicking a tab re-renders the tab bar, so a handle
    # taken before the click goes stale.
    match_index = next(i for i, t in enumerate(tabs) if "match" in t.lower())
    driver.execute_script(
        "document.querySelectorAll('#tabBar button')[arguments[0]].click();", match_index
    )
    time.sleep(2.5)
    matches_text = " ".join(texts_of(driver, "#lfContent"))
    tc.measure("matches_panel_chars", len(matches_text))
    tc.shot("potential-matches")

    if "%" in matches_text or "confidence" in matches_text.lower():
        tc.note("Jaccard confidence score is displayed on the match cards")
    else:
        tc.note(
            "No match suggestions exist right now - the panel rendered its empty state, so "
            "the confidence score and attribute tags could not be asserted."
        )
    assert matches_text.strip(), "The Potential Matches tab rendered nothing at all"


# ===========================================================================
# TC-VT-F07  Chatbot Management
# ===========================================================================


@testcase(
    "TC-VT-F07", "Chatbot Management",
    "Home analytics, the per-barangay chart, and the Inquiry/Consultation tables all load",
    category="functional", role="vet",
)
def test_chatbot_management(as_vet, driver, tc, charts):
    as_vet(pages.VET_CHATBOT_MGMT)

    click(driver, (By.CSS_SELECTOR, "[data-tab-target='home']"))
    wait(driver, 35).until(lambda d: has_digits(text_of(d, (By.ID, "value-online-consult"))))
    summary = {
        "consultations": text_of(driver, (By.ID, "value-online-consult")),
        "inquiries": text_of(driver, (By.ID, "value-online-inquiry")),
        "common_symptom": text_of(driver, (By.ID, "value-most-common-symptom")),
    }
    for key, value in summary.items():
        tc.measure(key, value)
    assert summary["common_symptom"].strip(), "Most common symptom was left blank"
    tc.shot("chatbot-home")

    # -- Inquiry Management -------------------------------------------------
    click(driver, (By.CSS_SELECTOR, "[data-tab-target='inquiry']"))
    wait_for_count(driver, (By.CSS_SELECTOR, "#inquiry-table-body tr"), 1, timeout=30)
    tc.measure("inquiry_rows", element_count(driver, (By.CSS_SELECTOR, "#inquiry-table-body tr")))

    # -- Consultation Management --------------------------------------------
    click(driver, (By.CSS_SELECTOR, "[data-tab-target='consultation']"))
    wait_for_count(driver, (By.CSS_SELECTOR, "#consultation-table-body tr"), 1, timeout=30)
    tc.measure("consultation_rows",
               element_count(driver, (By.CSS_SELECTOR, "#consultation-table-body tr")))
    tc.shot("chatbot-tables")

    # -- chart last --------------------------------------------------------
    click(driver, (By.CSS_SELECTOR, "[data-tab-target='home']"))
    problem = _chart_problem(driver, "consultationInquiryChart", charts,
                             "The consultations/inquiries per barangay chart")
    tc.measure("barangay_chart_render", "no" if problem else "yes")
    assert not problem, problem


# ===========================================================================
# TC-VT-F08  Report generation and export
# ===========================================================================


def _downloads_dir() -> str:
    folder = os.path.join(config.REPORT_DIR, "downloads")
    os.makedirs(folder, exist_ok=True)
    return folder


def _downloaded_files() -> set[str]:
    return {
        name for name in os.listdir(_downloads_dir())
        if not name.endswith((".crdownload", ".tmp"))
    }


def _await_download(before: set[str], timeout: float = 45) -> str | None:
    end = time.time() + timeout
    while time.time() < end:
        new = _downloaded_files() - before
        for name in new:
            if os.path.getsize(os.path.join(_downloads_dir(), name)) > 0:
                return name
        time.sleep(0.5)
    return None


def _export(driver, fmt: str) -> str | None:
    before = _downloaded_files()
    click(driver, (By.ID, "export-button"))
    visible(driver, (By.ID, "export-modal-overlay"), timeout=15)
    click(driver, (By.CSS_SELECTOR, f".export-option[data-format='{fmt}']"))
    click(driver, (By.ID, "export-download"))
    return _await_download(before)


@testcase(
    "TC-VT-F08", "Report Generation and Export",
    "Report statistics load, filter and sort apply, and CSV and PDF exports download",
    category="functional", role="vet",
)
def test_report_filters_and_export(as_vet, driver, tc):
    as_vet(pages.VET_REPORT)

    wait(driver, 35).until(lambda d: has_digits(text_of(d, (By.ID, "metric-total"))))
    tc.measure("total_patients", text_of(driver, (By.ID, "metric-total")))
    tc.measure("most_common", text_of(driver, (By.ID, "metric-disease")))
    tc.measure("most_active_barangay", text_of(driver, (By.ID, "metric-barangay")))

    wait_for_count(driver, (By.CSS_SELECTOR, "#report-table-body tr"), 1, timeout=35)
    tc.measure("summary_before", text_of(driver, (By.ID, "report-summary")))

    # -- filter ------------------------------------------------------------
    click(driver, (By.ID, "filter-button"))
    visible(driver, (By.ID, "filter-popover"), timeout=10)
    date_options = [
        o.get_attribute("value")
        for o in driver.find_elements(By.CSS_SELECTOR, "#date-type option")
        if o.get_attribute("value")
    ]
    if len(date_options) > 1:
        select_by_value(driver, (By.ID, "date-type"), date_options[1])
        tc.note(f"Date filter set to {date_options[1]!r}")
    click(driver, (By.ID, "filter-done"))
    time.sleep(1.8)
    tc.measure("summary_after_filter", text_of(driver, (By.ID, "report-summary")))

    # -- sort --------------------------------------------------------------
    click(driver, (By.ID, "sort-button"))
    visible(driver, (By.ID, "sort-popover"), timeout=10)
    select_by_value(driver, (By.ID, "sort-dir"), "desc")
    click(driver, (By.ID, "sort-done"))
    time.sleep(1.8)
    tc.note("Sort direction switched to descending")
    tc.shot("report-filtered")

    # -- exports -----------------------------------------------------------
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
