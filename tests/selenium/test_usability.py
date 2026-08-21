"""Usability Testing  (TC-PO-U01..U05, TC-VT-U01..U05, TC-AD-U01..U03).

What automation can and cannot say here
---------------------------------------
"Can a first-time user complete this without help?" is a question for a person
with a stopwatch, and no assertion replaces that. What a browser CAN check is
the set of concrete conditions those judgements rest on, and which quietly
break during development:

  * every input a user must fill has a label they can read
  * required fields are marked as required
  * an invalid entry produces a specific message, near the field, that names
    what is wrong - not a generic "error"
  * the current page/tab/step is visually distinguishable from the others
  * headings, tab labels and column headers are present and descriptive
  * nothing overflows horizontally, and no image renders as a broken icon

Each case below automates those, and records a note naming the part that still
needs a human observer. Read the two together.
"""

from __future__ import annotations

import time


from support import pages
from support.helpers import (
    By,
    click,
    dismiss_overlays,
    element_count,
    is_displayed,
    text_of,
    texts_of,
    type_into,
    visible,
    wait,
    wait_for_js,
)
from support.marks import testcase

# ---------------------------------------------------------------------------
# shared DOM audits
# ---------------------------------------------------------------------------

UNLABELLED_INPUTS = """
const scope = document.querySelector(arguments[0]) || document;
const fields = Array.from(scope.querySelectorAll('input, select, textarea'));
return fields.filter(el => {
    if (el.type === 'hidden' || el.offsetParent === null) return false;
    if (el.getAttribute('aria-label') || el.getAttribute('aria-labelledby')) return false;
    if (el.id && document.querySelector(`label[for="${el.id}"]`)) return false;
    if (el.closest('label')) return false;
    // A labelled group: a <label> anywhere in the owning field wrapper.
    const group = el.closest('.form-group, .field, .dash-form-group, .form-row, .input-icon-row, .wm-field');
    if (group && group.querySelector('label')) return false;
    if (el.placeholder && el.placeholder.trim().length > 2) return 'placeholder-only';
    return true;
}).map(el => ({
    id: el.id || null,
    name: el.name || null,
    type: el.type || el.tagName.toLowerCase(),
    placeholder: el.placeholder || null,
}));
"""

HORIZONTAL_OVERFLOW = """
return Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth);
"""

BROKEN_IMAGES = """
return Array.from(document.images)
    .filter(i => i.complete && i.naturalWidth === 0)
    .map(i => (i.getAttribute('src') || '').split('/').pop())
    .slice(0, 8);
"""

MISSING_ALT = """
return Array.from(document.images)
    .filter(i => i.offsetParent !== null && !i.hasAttribute('alt'))
    .map(i => (i.getAttribute('src') || '').split('/').pop())
    .slice(0, 8);
"""


def _audit_page(driver, tc, scope: str = "body", allow_overflow: int = 0) -> None:
    """The checks worth running on any screen, recorded rather than asserted."""
    unlabelled = driver.execute_script(UNLABELLED_INPUTS, scope)
    tc.measure("unlabelled_fields", len(unlabelled))
    if unlabelled:
        tc.note("Fields with no readable label: "
                + ", ".join(str(f.get("id") or f.get("name") or f["type"]) for f in unlabelled[:6]))

    overflow = driver.execute_script(HORIZONTAL_OVERFLOW)
    tc.measure("horizontal_overflow_px", overflow)

    broken = driver.execute_script(BROKEN_IMAGES)
    tc.measure("broken_images", len(broken))
    if broken:
        tc.note("Broken images: " + ", ".join(broken))

    missing_alt = driver.execute_script(MISSING_ALT)
    tc.measure("images_without_alt", len(missing_alt))

    assert overflow <= allow_overflow, (
        f"The page scrolls sideways by {overflow}px, so content is cut off at this width"
    )


def _distinct_active_item(driver, selector: str, active_selector: str) -> dict:
    """Compares the computed style of the active nav/tab item against an inactive one.

    A class name alone proves nothing - the point of an active indicator is
    that it *looks* different.
    """
    return driver.execute_script(
        """
        const [all, activeSel] = arguments;
        const items = Array.from(document.querySelectorAll(all))
            .filter(el => el.offsetParent !== null);
        const active = document.querySelector(activeSel);
        const inactive = items.find(el => el !== active);
        if (!active || !inactive) return {found: false};
        const a = getComputedStyle(active), b = getComputedStyle(inactive);
        return {
            found: true,
            colorDiffers: a.color !== b.color,
            weightDiffers: a.fontWeight !== b.fontWeight,
            backgroundDiffers: a.backgroundColor !== b.backgroundColor,
            borderDiffers: a.borderBottomColor !== b.borderBottomColor
                || a.borderBottomWidth !== b.borderBottomWidth,
            activeText: active.textContent.trim(),
        };
        """,
        selector,
        active_selector,
    )


# ===========================================================================
# PET OWNER
# ===========================================================================


@testcase(
    "TC-PO-U01", "Registration and Onboarding Flow",
    "Fields are labelled, validation messages are specific and visible, next step is explained",
    category="usability", role="owner",
)
def test_registration_form_is_self_explanatory(driver, tc):
    driver.get(pages.REGISTER)
    wait_for_js(driver, "document.readyState === 'complete'")
    dismiss_overlays(driver)

    _audit_page(driver, tc, "#step-1")

    labels = texts_of(driver, "#step-1 label")
    tc.measure("labelled_fields", len(labels))
    assert len(labels) >= 5, f"Step 1 only labels {len(labels)} fields: {labels}"

    # The stepper has to say where the user is and how far there is to go.
    steps = texts_of(driver, ".stepper .step-label")
    tc.measure("stepper", " > ".join(steps))
    assert len(steps) >= 3, f"The registration stepper does not show the stages: {steps}"

    # An empty submit must produce a specific, visible message - not silence.
    click(driver, (By.CSS_SELECTOR, "#step-1 .btn-primary"))
    error = wait(driver, 10).until(lambda d: text_of(d, (By.ID, "step1-error")) or False)
    tc.measure("empty_form_error", error)
    tc.shot("empty-form-error")
    assert "name" in error.lower(), \
        f"The first validation message should name the missing field; it said {error!r}"

    # ... and a wrong value must be answered field by field, not generically.
    type_into(driver, (By.ID, "reg_fullname"), "Automation Applicant")
    type_into(driver, (By.ID, "reg_email"), "not-an-email")
    click(driver, (By.CSS_SELECTOR, "#step-1 .btn-primary"))
    email_error = wait(driver, 10).until(
        lambda d: (text_of(d, (By.ID, "step1-error")) or "") != error
        and text_of(d, (By.ID, "step1-error"))
    )
    tc.measure("invalid_email_error", email_error)
    assert "email" in email_error.lower(), \
        f"An invalid email should be called out as such; it said {email_error!r}"

    # A weak password has to explain the rule, not just refuse.
    type_into(driver, (By.ID, "reg_email"), "someone@example.com")
    type_into(driver, (By.ID, "reg_pw1"), "abc")
    click(driver, (By.CSS_SELECTOR, "#step-1 .btn-primary"))
    pw_error = wait(driver, 10).until(
        lambda d: "password" in (text_of(d, (By.ID, "step1-error")) or "").lower()
        and text_of(d, (By.ID, "step1-error"))
    )
    tc.measure("weak_password_error", pw_error)
    assert any(ch.isdigit() for ch in pw_error) or "character" in pw_error.lower(), (
        "The password message should state the requirement it failed; it said "
        f"{pw_error!r}"
    )

    tc.note(
        "Still needs a human: whether a first-time user understands what counts as valid "
        "proof of Baliwag residency, and whether the pending-verification wording sets the "
        "right expectation about how long approval takes."
    )


@testcase(
    "TC-PO-U02", "Navigation and Page Accessibility",
    "Navigation is labelled, consistent across pages, and marks the current page visibly",
    category="usability", role="owner",
)
def test_owner_navigation_is_consistent(as_owner, driver, tc):
    as_owner(pages.LANDING)

    landing_nav = texts_of(driver, ".nav-links a")
    tc.measure("nav_items", " | ".join(landing_nav))
    for expected in ("Home", "Book An Appointment", "Lost And Found"):
        assert expected in landing_nav, f"Navigation is missing {expected!r}: {landing_nav}"

    active = _distinct_active_item(driver, ".nav-links a", ".nav-links a.active")
    tc.measure("active_page_indicator", active)
    assert active.get("found"), "No active navigation item is marked at all"
    assert any(active[key] for key in
               ("colorDiffers", "weightDiffers", "backgroundDiffers", "borderDiffers")), (
        "The current page is not visually distinguishable from the other navigation items"
    )
    _audit_page(driver, tc)
    tc.shot("landing-nav")

    # The same bar, in the same order, on every primary page.
    for label, url in (("Book an Appointment", pages.BOOK_APPOINTMENT),
                       ("Lost and Found", pages.LOST_FOUND)):
        as_owner(url)
        nav = texts_of(driver, ".nav-links a")
        assert nav == landing_nav, (
            f"The navigation bar changes on {label}: {nav} instead of {landing_nav}"
        )
    tc.measure("nav_consistent_across_pages", True)

    tc.note(
        "Still needs a human: whether the labels match the words a pet owner would use, "
        "and whether anything important is hidden behind the account dropdown."
    )


@testcase(
    "TC-PO-U03", "Appointment Booking Form Usability",
    "Step indicators, field labels, required markers and inline error feedback are all present",
    category="usability", role="owner",
)
def test_booking_form_guides_the_user(as_owner, driver, tc):
    as_owner(pages.BOOK_APPOINTMENT)
    click(driver, (By.ID, "btnBook"))
    wait(driver, 15).until(lambda d: is_displayed(d, (By.ID, "step1")))

    eyebrow = text_of(driver, (By.ID, "bookingEyebrow"))
    tc.measure("progress_text", eyebrow)
    assert "of 4" in eyebrow.lower(), \
        f"The form should say which of how many steps this is; it said {eyebrow!r}"

    step_labels = texts_of(driver, ".hstep-label")
    tc.measure("step_labels", " > ".join(step_labels))
    assert len(step_labels) == 4, f"Expected four named steps, found {step_labels}"

    active_step = _distinct_active_item(driver, ".hstep-dot", ".hstep-dot.active")
    tc.measure("current_step_indicator", active_step)
    assert active_step.get("found"), "The current step is not marked in the stepper"

    _audit_page(driver, tc, "#step1")
    labels = texts_of(driver, "#step1 .form-label")
    tc.measure("step1_labels", " | ".join(labels))
    required = [label for label in labels if "*" in label]
    tc.measure("required_markers", len(required))
    assert required, f"No required field is marked with an asterisk: {labels}"

    # Trying to advance with the form empty must point at the fields.
    click(driver, (By.ID, "s1Next"))
    errors = wait(driver, 10).until(
        lambda d: texts_of(d, "#step1 .field-error, #step1 .error-text, #step1 .has-error") or False
    )
    tc.measure("inline_errors", len(errors))
    tc.note("Errors shown: " + " | ".join(e for e in errors if e)[:180])
    tc.shot("booking-validation")
    assert any(e.strip() for e in errors), \
        "Advancing with an empty form produced no visible field-level message"

    # Still on step 1 - the form must not let an incomplete step through.
    assert is_displayed(driver, (By.ID, "step1")), \
        "The form advanced past step 1 despite the required fields being empty"

    tc.note(
        "Still needs a human: whether the four-step split matches how owners think about "
        "booking, and whether the time-slot grid reads as available-vs-taken at a glance."
    )


@testcase(
    "TC-PO-U04", "Lost and Found Hub Usability",
    "The report actions are prominent and labelled, and the form fields are understandable",
    category="usability", role="owner",
)
def test_lost_found_hub_is_navigable(as_owner, driver, tc):
    as_owner(pages.LOST_FOUND)

    buttons = texts_of(driver, ".btn-report")
    tc.measure("report_actions", " | ".join(buttons))
    assert any("lost" in b.lower() for b in buttons), f"No Report a Lost Pet action: {buttons}"
    assert any("found" in b.lower() for b in buttons), f"No Report Found Pet action: {buttons}"

    # Prominent means: on screen without scrolling.
    above_fold = driver.execute_script(
        """
        return Array.from(document.querySelectorAll('.btn-report')).map(el => {
            const r = el.getBoundingClientRect();
            return {text: el.textContent.trim(), top: Math.round(r.top),
                    visible: r.top >= 0 && r.top < window.innerHeight,
                    height: Math.round(r.height)};
        });
        """
    )
    tc.measure("report_buttons", above_fold)
    assert all(b["visible"] for b in above_fold), \
        f"A report action is below the fold on first paint: {above_fold}"
    assert all(b["height"] >= 32 for b in above_fold), \
        f"A report action is too small to be a comfortable target: {above_fold}"

    tabs = texts_of(driver, ".tab")
    tc.measure("board_tabs", " | ".join(tabs))
    active_tab = _distinct_active_item(driver, ".tab", ".tab.active")
    tc.measure("active_tab_indicator", active_tab)
    assert active_tab.get("found"), "No tab is marked as the current one"

    _audit_page(driver, tc)

    # The report form itself.
    click(driver, (By.CSS_SELECTOR, ".btn-report.light"))
    visible(driver, (By.ID, "reportModal"), timeout=15)
    _audit_page(driver, tc, "#reportModal")
    modal_labels = texts_of(driver, "#reportModal label")
    tc.measure("report_form_labels", len(modal_labels))
    assert len(modal_labels) >= 6, \
        f"The report form only labels {len(modal_labels)} fields: {modal_labels}"
    tc.shot("lost-found-form")

    tc.note(
        "Still needs a human: whether the four-step 'what happens next' screen actually "
        "sets expectations, and whether owners understand that a report is reviewed "
        "before it goes public."
    )


@testcase(
    "TC-PO-U05", "Chatbot Interaction Usability",
    "The chatbot is discoverable, its tabs are labelled and its answer is plain language",
    category="usability", role="owner",
)
def test_chatbot_is_discoverable_and_clear(as_owner, driver, tc):
    as_owner(pages.LANDING)

    fab = driver.execute_script(
        """
        const el = document.getElementById('chatbotFab');
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return {label: el.getAttribute('aria-label'),
                visible: r.top >= 0 && r.bottom <= window.innerHeight && r.width > 0,
                size: Math.round(Math.min(r.width, r.height))};
        """
    )
    tc.measure("chat_launcher", fab)
    assert fab, "The chatbot launcher is not on the home page at all"
    assert fab["visible"], "The chatbot launcher is not visible without scrolling"
    assert fab["size"] >= 40, f"The chatbot launcher is only {fab['size']}px - hard to hit"
    assert fab["label"], "The chatbot launcher has no accessible label"

    click(driver, (By.ID, "chatbotFab"))
    visible(driver, (By.ID, "chatbotPanel"), timeout=15)
    tabs = [text_of(driver, (By.ID, "tabInquiry")), text_of(driver, (By.ID, "tabConsultation"))]
    tc.measure("tabs", " | ".join(tabs))
    assert all(t.strip() for t in tabs), f"A chatbot tab has no label: {tabs}"

    options = texts_of(driver, "#inquiryOptions .option-btn")
    wait(driver, 25).until(lambda d: len(texts_of(d, "#inquiryOptions .option-btn")) > 0)
    options = texts_of(driver, "#inquiryOptions .option-btn")
    tc.measure("inquiry_options", len(options))
    assert options, "The inquiry tab offers no selectable topics"
    tc.note("Topics offered: " + ", ".join(o.split("\n")[0] for o in options[:6]))
    tc.shot("chatbot")

    schedule = next(b for b in driver.find_elements(By.CSS_SELECTOR, "#inquiryOptions .option-btn")
                    if "clinic schedule" in b.text.lower())
    driver.execute_script("arguments[0].click();", schedule)
    wait(driver, 25).until(
        lambda d: element_count(d, (By.CSS_SELECTOR, "#inquiryMessages .chat-info-box")) > 0
    )
    answer = text_of(driver, (By.CSS_SELECTOR, "#inquiryMessages .chat-info-box"))
    words = answer.split()
    longest = max((len(w) for w in words), default=0)
    tc.measure("answer_words", len(words))
    tc.measure("longest_word", longest)
    assert len(words) >= 5, f"The answer is too terse to be useful: {answer!r}"

    tc.note(
        "Still needs a human: whether the consultation recommendation (home care / book an "
        "appointment / emergency) reads as actionable advice to a worried owner."
    )


# ===========================================================================
# VETERINARIAN
# ===========================================================================


@testcase(
    "TC-VT-U01", "Dashboard Layout and Information Hierarchy",
    "Clinical metrics are in labelled cards and the sidebar labels are descriptive",
    category="usability", role="vet",
)
def test_vet_dashboard_hierarchy(as_vet, driver, tc):
    as_vet(pages.VET_DASHBOARD)
    wait(driver, 35).until(lambda d: len(texts_of(d, ".sidebar .nav-label")) > 5)

    sidebar = texts_of(driver, ".sidebar .nav-label")
    tc.measure("sidebar_labels", " | ".join(sidebar))
    vague = [label for label in sidebar if len(label) < 4 or label.lower() in ("misc", "other")]
    assert not vague, f"Sidebar entries that do not say what they lead to: {vague}"

    cards = driver.execute_script(
        """
        return Array.from(document.querySelectorAll(
            '#dashboard-content .greet-stat, #dashboard-content .kpi-card, .stat-card'))
            .filter(el => el.offsetParent !== null)
            .map(el => el.innerText.replace(/\\s+/g, ' ').trim())
            .filter(Boolean).slice(0, 10);
        """
    )
    tc.measure("summary_cards", len(cards))
    tc.note("Cards: " + " | ".join(cards)[:220])
    assert cards, "No labelled summary cards were found on the dashboard"
    unlabelled = [c for c in cards if not any(ch.isalpha() for ch in c)]
    assert not unlabelled, f"Summary values shown without a caption: {unlabelled}"

    _audit_page(driver, tc)
    tc.shot("vet-dashboard")

    active = _distinct_active_item(driver, ".sidebar .nav-item", ".sidebar .nav-item.active")
    tc.measure("active_module_indicator", active)

    tc.note(
        "Still needs a human: the 30-second comprehension check - whether a vet can find the "
        "patient volume forecast, chatbot summary and appointment counts without being told."
    )


@testcase(
    "TC-VT-U02", "Patient Records Search and Filter Usability",
    "Search, filters, column headers and row actions are all labelled and readable",
    category="usability", role="vet",
)
def test_patient_records_controls_are_labelled(as_vet, driver, tc):
    as_vet(pages.VET_PATIENT_RECORDS)
    wait(driver, 40).until(
        lambda d: element_count(d, (By.CSS_SELECTOR, ".records-table tbody tr")) > 0
    )

    search_hint = driver.execute_script(
        "const el = document.getElementById('search-input');"
        "return el ? (el.placeholder || el.getAttribute('aria-label') || '') : null;"
    )
    tc.measure("search_hint", search_hint)
    assert search_hint and len(search_hint) > 5, \
        f"The search box does not say what it searches: {search_hint!r}"

    filters = texts_of(driver, "[data-filter-type]")
    tc.measure("filter_labels", " | ".join(filters))
    assert len(filters) >= 3, f"Expected species filters, found {filters}"
    assert all(f.strip() for f in filters), "A filter button has no text on it"

    headers = texts_of(driver, ".records-table thead th")
    tc.measure("column_headers", " | ".join(headers))
    assert len(headers) >= 4, f"The patient table has too few labelled columns: {headers}"
    assert all(h.strip() for h in headers[:-1]), f"A column header is blank: {headers}"

    actions = driver.execute_script(
        """
        return Array.from(document.querySelectorAll('.records-table tbody button'))
            .slice(0, 6)
            .map(b => (b.textContent.trim() || b.getAttribute('aria-label')
                       || b.getAttribute('title') || ''));
        """
    )
    tc.measure("row_actions", " | ".join(a for a in actions if a))
    assert all(a for a in actions), \
        "A row action button has neither a label, an aria-label nor a title"

    _audit_page(driver, tc)
    tc.shot("patient-records-controls")

    tc.note(
        "Still needs a human: whether the filter names (Canine / Feline / Exotic) match how "
        "the clinic actually talks about its patients."
    )


@testcase(
    "TC-VT-U03", "Disease Analytics Dashboard Usability",
    "Overview cards, chart titles and the disease filter are readable without explanation",
    category="usability", role="vet",
)
def test_disease_analytics_is_readable(as_vet, driver, tc):
    as_vet(pages.VET_DISEASE_ANALYTICS)
    wait(driver, 45).until(lambda d: len(texts_of(d, "#kpiCards > *")) > 0)

    cards = texts_of(driver, "#kpiCards > *")
    tc.measure("overview_cards", " | ".join(c.replace("\n", " ") for c in cards)[:240])
    for card in cards:
        assert any(ch.isalpha() for ch in card), \
            f"An overview card shows a number with no caption: {card!r}"

    titles = texts_of(driver, ".chart-card h2, .chart-card h3, .card h2, .card h3")
    tc.measure("chart_titles", " | ".join(titles)[:200])
    joined = " ".join(titles).lower()
    assert "actual" in joined, f"No chart is titled as the actual cases: {titles}"
    # The plan calls it "predicted"; the page says "Advanced Forecast - Projected
    # Annual". Any of those tells a reader it is a projection, which is the
    # property under test.
    assert any(word in joined for word in ("predict", "forecast", "project")), \
        f"No chart is titled in a way that marks it as a projection: {titles}"

    filter_label = driver.execute_script(
        "const el = document.getElementById('diseaseFilter');"
        "return el ? (el.getAttribute('aria-label') || '') : null;"
    )
    tc.measure("disease_filter_label", filter_label)
    assert filter_label, "The disease filter has no accessible label"

    # Barangay names on the bars have to be readable, not truncated to nothing.
    bar_labels = texts_of(driver, "#actualChart > * .bar-label, #actualChart > * span")
    tc.measure("bar_labels_sampled", len(bar_labels))
    if bar_labels:
        tc.note("Bar labels: " + ", ".join(bar_labels[:8]))

    _audit_page(driver, tc)
    tc.shot("disease-analytics-readability")

    tc.note(
        "Still needs a human: whether a vet reads the predicted chart as a forecast rather "
        "than as recorded fact, and whether 'Auto Alerts' is understood without training."
    )


@testcase(
    "TC-VT-U04", "Lost and Found Match Review Usability",
    "Tabs, match cards and the approve/reject actions are clearly labelled",
    category="usability", role="vet",
)
def test_lost_found_review_is_clear(as_vet, driver, tc):
    as_vet(pages.VET_LOST_FOUND)
    wait(driver, 35).until(lambda d: len(texts_of(d, "#tabBar button")) > 0)

    tabs = texts_of(driver, "#tabBar button")
    tc.measure("tabs", " | ".join(tabs))
    assert all(t.strip() for t in tabs), f"A tab has no label: {tabs}"

    active_tab = _distinct_active_item(driver, "#tabBar button", "#tabBar button.is-active")
    if not active_tab.get("found"):
        active_tab = _distinct_active_item(driver, "#tabBar button", "#tabBar button.active")
    tc.measure("active_tab_indicator", active_tab)

    match_index = next(i for i, t in enumerate(tabs) if "match" in t.lower())
    driver.execute_script(
        "document.querySelectorAll('#tabBar button')[arguments[0]].click();", match_index
    )
    time.sleep(2.5)

    panel = " ".join(texts_of(driver, "#lfContent"))
    tc.measure("matches_panel_chars", len(panel))
    buttons = texts_of(driver, "#lfContent button")
    tc.measure("actions", " | ".join(b for b in buttons if b)[:200])

    if any("approve" in b.lower() for b in buttons):
        assert any("dismiss" in b.lower() or "reject" in b.lower() for b in buttons), (
            "An approve action is offered without a matching reject/dismiss, so there is no "
            "way to say no"
        )
        tc.note("Approve and dismiss are both offered on the match cards")
    else:
        tc.note("No match suggestions are pending, so the action labels could not be checked")

    _audit_page(driver, tc)
    tc.shot("match-review")

    tc.note(
        "Still needs a human: whether the Jaccard confidence score and the matched-attribute "
        "tags give a vet enough to decide, or whether they have to open both records anyway."
    )


@testcase(
    "TC-VT-U05", "Mass Vaccination ARIMA Forecast Readability",
    "The forecast chart is titled, its axes explained, and the statistics are in plain language",
    category="usability", role="vet",
)
def test_arima_forecast_is_readable(as_vet, driver, tc, charts):
    as_vet(pages.VET_MASS_VACCINATION)
    wait(driver, 40).until(
        lambda d: element_count(d, (By.CSS_SELECTOR, "#event-table-body tr")) > 0
    )

    titles = texts_of(driver, ".chart-card h2, .chart-card h3, .card h2, .card h3, h3")
    tc.measure("chart_titles", " | ".join(titles)[:220])
    joined = " ".join(titles).lower()
    assert "vaccinated" in joined, f"No chart is titled in terms of pets vaccinated: {titles}"
    assert "predict" in joined, f"The forecast chart is not titled as a prediction: {titles}"

    # Plain language: the headline statistics must be captioned, not bare numbers.
    stat_blocks = driver.execute_script(
        """
        return Array.from(document.querySelectorAll('.kpi-card, .stat-card, .metric-card'))
            .filter(el => el.offsetParent !== null)
            .map(el => el.innerText.replace(/\\s+/g, ' ').trim())
            .filter(Boolean).slice(0, 8);
        """
    )
    tc.measure("statistic_cards", len(stat_blocks))
    for block in stat_blocks:
        assert any(ch.isalpha() for ch in block), f"A statistic has no caption: {block!r}"

    # Axis titles and label crowding can only be read out of the chart object.
    config_info = driver.execute_script(
        """
        const c = document.getElementById('predictedAnimalsChart');
        if (!c || typeof Chart === 'undefined' || !Chart.getChart) return null;
        const chart = Chart.getChart(c);
        if (!chart) return null;
        const scales = chart.options.scales || {};
        const title = (ax) => (scales[ax] && scales[ax].title && scales[ax].title.display)
            ? scales[ax].title.text : null;
        return {
            labels: (chart.data.labels || []).length,
            datasets: (chart.data.datasets || []).map(d => d.label),
            xTitle: title('x'), yTitle: title('y'),
            legendShown: !!(chart.options.plugins && chart.options.plugins.legend
                            && chart.options.plugins.legend.display !== false),
        };
        """
    )
    tc.measure("forecast_chart", config_info)
    if config_info is None:
        tc.note(
            "The forecast chart could not be inspected because Chart.js is not loaded. "
            + (charts["reason"] or "")
        )
    else:
        assert config_info["datasets"] and all(config_info["datasets"]), (
            "The forecast chart's series are unnamed, so predicted and actual cannot be "
            "told apart from the legend"
        )

    # An unsized canvas (Chart.js absent) sticks out of its container and takes
    # the whole document with it, so only hold the page to the no-sideways-
    # scrolling rule when the chart library actually loaded.
    _audit_page(driver, tc, allow_overflow=0 if charts["ok"] else 400)
    if not charts["ok"]:
        tc.note(
            "Horizontal overflow is not asserted on this run: with Chart.js missing the "
            "forecast canvas keeps its intrinsic 300px size and overhangs its column."
        )
    tc.shot("arima-readability")

    tc.note(
        "Still needs a human: whether a vet can pick out the highest-demand barangay at a "
        "glance, and whether the barangay labels stay legible at the clinic's screen size."
    )


# ===========================================================================
# ADMIN
# ===========================================================================


@testcase(
    "TC-AD-U01", "Admin Dashboard and Sidebar Navigation Usability",
    "System statistics are captioned and every sidebar module is reachable and labelled",
    category="usability", role="admin",
)
def test_admin_dashboard_navigation(as_admin, driver, tc):
    as_admin(pages.ADMIN_DASHBOARD)
    wait(driver, 35).until(lambda d: len(texts_of(d, ".sidebar .nav-label")) > 5)

    sidebar = texts_of(driver, ".sidebar .nav-label")
    tc.measure("sidebar_labels", " | ".join(sidebar))
    assert all(len(label) >= 4 for label in sidebar), \
        f"A sidebar entry is too terse to be understood: {sidebar}"

    cards = driver.execute_script(
        """
        return Array.from(document.querySelectorAll('.kpi-card, .greet-stat'))
            .filter(el => el.offsetParent !== null)
            .map(el => el.innerText.replace(/\\s+/g, ' ').trim())
            .filter(Boolean).slice(0, 10);
        """
    )
    tc.measure("statistic_cards", len(cards))
    tc.note("Cards: " + " | ".join(cards)[:220])
    for card in cards:
        assert any(ch.isalpha() for ch in card), f"A statistic has no caption: {card!r}"

    # Every module in the sidebar has to go somewhere, and come back.
    visited = {}
    for label, url in (("Account Management", pages.ADMIN_ACCOUNTS),
                       ("Website Management", pages.ADMIN_WEBSITE)):
        as_admin(url)
        wait_for_js(driver, "document.readyState === 'complete'")
        visited[label] = url.rsplit("/", 1)[-1] in driver.current_url
        assert visited[label], f"{label} did not open from its URL"
    as_admin(pages.ADMIN_DASHBOARD)
    tc.measure("modules_reachable", ", ".join(f"{k}={v}" for k, v in visited.items()))

    _audit_page(driver, tc)
    tc.shot("admin-dashboard-usability")

    tc.note(
        "Still needs a human: the 30-second comprehension check on the dashboard, and "
        "whether the sidebar grouping (Administration vs the clinical modules) reads as "
        "a sensible split."
    )


@testcase(
    "TC-AD-U02", "Account Management Interface Usability",
    "Roles, statuses and actions are distinguishable, and the create-user form is labelled",
    category="usability", role="admin",
)
def test_account_management_is_readable(as_admin, driver, tc):
    as_admin(pages.ADMIN_ACCOUNTS)
    wait(driver, 35).until(
        lambda d: element_count(d, (By.CSS_SELECTOR, "#user-table-body tr")) > 0
    )

    headers = texts_of(driver, "thead th")
    tc.measure("column_headers", " | ".join(headers))
    lowered = " ".join(headers).lower()
    for column in ("role", "status"):
        assert column in lowered, f"The user table has no {column!r} column: {headers}"

    # Role and status badges have to be told apart by more than their text.
    badge_styles = driver.execute_script(
        """
        const badges = Array.from(document.querySelectorAll('#user-table-body .am-role-badge'));
        const seen = {};
        badges.forEach(b => {
            const key = b.textContent.trim();
            if (!seen[key]) seen[key] = getComputedStyle(b).backgroundColor;
        });
        return seen;
        """
    )
    tc.measure("role_badges", badge_styles)
    assert badge_styles, "No role badges are rendered"
    if len(badge_styles) > 1:
        assert len(set(badge_styles.values())) > 1, (
            "Every role badge uses the same colour, so roles are only distinguishable "
            f"by reading them: {badge_styles}"
        )

    actions = texts_of(driver, "#user-table-body .am-actions-cell button")
    tc.measure("row_actions", " | ".join(sorted(set(a for a in actions if a)))[:160])
    assert all(a.strip() for a in actions), "A row action button has no label"

    # Create New User form.
    click(driver, (By.ID, "btn-add-user"))
    visible(driver, (By.ID, "modal-add-account"), timeout=15)
    _audit_page(driver, tc, "#modal-add-account")
    labels = texts_of(driver, "#modal-add-account .dash-label")
    tc.measure("create_form_labels", " | ".join(labels))
    assert len(labels) >= 5, f"The Create New User form only labels {len(labels)} fields"
    tc.shot("account-management-usability")

    tc.note(
        "Still needs a human: whether an admin can tell at a glance which accounts need "
        "action, and whether Block vs Reject read as different consequences."
    )


@testcase(
    "TC-AD-U03", "Website Management Interface Usability",
    "Every content section is titled, its controls labelled, and the preview is present",
    category="usability", role="admin",
)
def test_website_management_is_organised(as_admin, driver, tc):
    as_admin(pages.ADMIN_WEBSITE)
    wait_for_js(driver, "document.readyState === 'complete'")
    wait(driver, 35).until(
        lambda d: d.find_element(By.ID, "cp-about").get_attribute("value") is not None
    )

    sections = driver.execute_script(
        """
        return ['section-brand-logo','section-assets','section-announcements',
                'section-profile','section-preview'].map(id => {
            const el = document.getElementById(id);
            if (!el) return {id, present: false};
            const heading = el.querySelector(
                'h1,h2,h3,h4,.wm-card-title,.wm-section-title,.wm-preview-title');
            return {id, present: true,
                    heading: heading ? heading.textContent.trim() : null};
        });
        """
    )
    tc.measure("sections", sections)
    missing = [s["id"] for s in sections if not s["present"]]
    assert not missing, f"Website settings is missing sections: {missing}"

    untitled = [s["id"] for s in sections if s["present"] and not s["heading"]]
    tc.measure("sections_without_heading", untitled)
    assert not untitled, (
        f"These sections have no visible heading, so their purpose is unlabelled: {untitled}"
    )

    _audit_page(driver, tc)

    save = driver.execute_script(
        """
        const el = document.getElementById('btn-save');
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return {text: el.textContent.trim(), visible: r.width > 0 && r.height > 0,
                sticky: getComputedStyle(el.parentElement || el).position};
        """
    )
    tc.measure("save_control", save)
    assert save and save["visible"] and save["text"], \
        "The Save Changes control is missing or unlabelled"
    tc.shot("website-management-usability")

    tc.note(
        "Still needs a human: whether an admin realises the live preview reflects unsaved "
        "changes, and whether it is obvious that Save applies to every section at once."
    )
