"""Functionality Testing - Pet Owner  (TC-PO-F01 .. TC-PO-F08)."""

from __future__ import annotations

import datetime
import time

import pytest

from support import auth, config, db, flows, pages
from support.helpers import (
    By,
    click,
    dismiss_overlays,
    is_displayed,
    select_by_text,
    select_first_real_option,
    set_date,
    text_of,
    type_into,
    visible,
    wait,
    wait_for_js,
)
from support.marks import testcase

REG_PASSWORD = "Rk8$tVn3Xw6!"


def _unique_email() -> str:
    """A throwaway address the cleanup step knows how to delete."""
    return f"selenium.reg.{int(time.time())}@bvetter.test"


def _next_weekday(days_ahead: int = 3) -> str:
    day = datetime.date.today() + datetime.timedelta(days=days_ahead)
    while day.weekday() >= 5:  # the booking form rejects Sat/Sun
        day += datetime.timedelta(days=1)
    return day.isoformat()


# ===========================================================================
# TC-PO-F01  User Registration
# ===========================================================================


@testcase(
    "TC-PO-F01", "User Registration",
    "Account is created with a pending status and the user is told it awaits admin verification",
    category="functional", role="owner",
)
def test_registration_creates_pending_account(driver, tc, mutating, needs_db):
    email = _unique_email()
    tc.note(f"Registered as {email}")

    driver.get(pages.REGISTER)
    wait_for_js(driver, "document.readyState === 'complete'")

    # -- Step 1: account detail ------------------------------------------
    type_into(driver, (By.ID, "reg_fullname"), "Automation Applicant")
    type_into(driver, (By.ID, "reg_email"), email)
    type_into(driver, (By.ID, "reg_pw1"), REG_PASSWORD)
    type_into(driver, (By.ID, "reg_pw2"), REG_PASSWORD)
    type_into(driver, (By.ID, "rv_phone"), "09171234567")
    barangay = select_first_real_option(driver, (By.ID, "reg_barangay"))
    tc.note(f"Barangay: {barangay}")
    click(driver, (By.ID, "reg_terms"))
    click(driver, (By.CSS_SELECTOR, "#step-1 .btn-primary"))

    # -- Email OTP gate ---------------------------------------------------
    # public/js/signup.js will not advance to step 2 until the address is
    # confirmed with a 6-digit code. The row is written before the mail is
    # attempted, so this works for a throwaway address no server will accept.
    visible(driver, (By.ID, "modal-otp-email"), timeout=15)
    code = None
    for _ in range(20):
        code = db.registration_otp(email)
        if code:
            break
        time.sleep(0.4)
    assert code, "No email-verification OTP was issued for the new registration"

    digits = driver.find_elements(By.CSS_SELECTOR, "#otp-email-inputs .otp-digit")
    assert len(digits) == 6, f"Expected 6 OTP inputs, found {len(digits)}"
    for box, digit in zip(digits, code):
        box.send_keys(digit)
    click(driver, (By.ID, "otp-email-verify-btn"))

    # A correct code closes the modal and advances straight to step 2.
    wait(driver, 20).until(
        lambda d: "active" in d.find_element(By.ID, "step-2").get_attribute("class")
    )

    # -- Step 2: proof of Baliwag residency -------------------------------
    from support.helpers import png_fixture

    driver.find_element(By.ID, "reg_proof").send_keys(png_fixture())
    wait(driver, 10).until(
        lambda d: d.execute_script(
            "return document.getElementById('reg_proof').files.length > 0;"
        )
    )
    click(driver, (By.CSS_SELECTOR, "#step-2 .btn-primary"))

    # -- Step 3: review and submit ----------------------------------------
    wait(driver, 15).until(
        lambda d: "active" in d.find_element(By.ID, "step-3").get_attribute("class")
    )
    assert driver.find_element(By.ID, "rv_email").get_attribute("value") == email
    assert is_displayed(driver, (By.ID, "email-verified-badge")), \
        "The review step should show the 'Email verified' badge after the OTP was accepted"
    tc.shot("step3-review")
    click(driver, (By.CSS_SELECTOR, "#step-3 .btn-primary"))

    # -- Step 4: the pending-verification message -------------------------
    wait(driver, 30).until(
        lambda d: "active" in d.find_element(By.ID, "step-4").get_attribute("class")
    )
    reference = text_of(driver, (By.ID, "reg_ref_number"))
    tc.measure("reference_number", reference)
    assert reference.startswith("#ACC-"), f"Unexpected reference number: {reference!r}"

    confirmation = driver.find_element(By.ID, "step-4").text.lower()
    assert any(word in confirmation for word in ("verif", "review", "pending", "approv")), (
        "The success screen must tell the user the account is awaiting verification. "
        f"It said: {confirmation[:200]!r}"
    )
    tc.shot("step4-pending")

    # -- and the account really is pending, not active --------------------
    row = db.user(email)
    assert row, "The registration did not create a user row"
    tc.measure("account_status", row["account_status"])
    tc.measure("verification_status", row["verification_status"])
    assert row["account_status"] == "inactive", \
        f"A brand-new registration must not be active (got {row['account_status']!r})"
    assert row["verification_status"] == "pending", \
        f"Residency proof must start as pending (got {row['verification_status']!r})"


# ===========================================================================
# TC-PO-F02  Account Login
# ===========================================================================


@testcase(
    "TC-PO-F02", "Account Login",
    "Verified owner is authenticated and lands on the home page with the owner navigation",
    category="functional", role="owner",
)
def test_owner_login_lands_on_home(driver, tc, owner_credentials):
    outcome = auth.login_owner(driver)
    assert outcome == "session", f"Login did not create a session ({outcome}): " \
                                 f"{auth.notice_message(driver)}"

    assert "landing.html" in driver.current_url, \
        f"Owner should land on the home page, got {driver.current_url}"

    nav = [a.text.strip() for a in driver.find_elements(By.CSS_SELECTOR, ".nav-links a")]
    tc.measure("nav_items", ", ".join(nav))
    for expected in ("Home", "Book An Appointment", "Lost And Found"):
        assert expected in nav, f"Navigation bar is missing {expected!r}; it shows {nav}"

    # The signed-in nav replaces the guest Register/Login pair.
    assert is_displayed(driver, (By.ID, "navAuth")), \
        "The authenticated navigation block should be visible after login"
    tc.shot("home")


# ===========================================================================
# TC-PO-F03  Forgot Password
# ===========================================================================


@testcase(
    "TC-PO-F03", "Forgot Password",
    "Reset link is issued, the new password is accepted, and the owner can log in with it",
    category="functional", role="owner",
)
def test_forgot_password_end_to_end(driver, tc, mutating, needs_db):
    new_password = "Yh5&qBmz9Rt3"
    email = config.OWNER_EMAIL

    try:
        # 1. request the reset from the login page's own link
        driver.get(pages.LOGIN)
        click(driver, (By.CSS_SELECTOR, ".forgot-link"))
        wait(driver, 15).until(lambda d: "forgot-password.html" in d.current_url)

        type_into(driver, (By.ID, "resetEmail"), email)
        click(driver, (By.CSS_SELECTOR, ".btn-send"))

        # 2. the emailed token - read from password_reset_tokens, because a
        #    browser cannot open an inbox (see support/dbq.php)
        token = None
        for _ in range(25):
            token = db.reset_token(email)
            if token:
                break
            time.sleep(0.4)

        if not token:
            # Say WHY, rather than just "no token". The usual cause is the
            # request never reaching the server at all.
            from support.helpers import console_errors

            on_page = driver.find_element(By.CSS_SELECTOR, ".card").text.replace("\n", " ")
            errors = console_errors(driver)
            tc.note(f"Page said: {on_page[:160]}")
            for message in errors[:3]:
                tc.note(f"Console: {message[:200]}")
            tc.shot("no-token-issued")
            raise AssertionError(
                "No password_reset_tokens row was created, so the reset email was "
                "never issued.\n"
                f"    Page showed: {on_page[:200]}\n"
                f"    Console errors: {errors[:2] or 'none'}"
            )
        tc.note("Reset token read from password_reset_tokens (mailbox stand-in)")

        # 3. follow the link and set a new password
        driver.get(f"{pages.RESET_PASSWORD}?token={token}")
        type_into(driver, (By.ID, "rp-new"), new_password)
        type_into(driver, (By.ID, "rp-confirm"), new_password)
        click(driver, (By.ID, "rp-submit"))

        message = wait(driver, 20).until(
            lambda d: (d.find_element(By.ID, "rp-msg").text or "").strip() or False
        )
        tc.measure("reset_message", message)
        assert "success" in message.lower() or "updated" in message.lower() \
            or "can now" in message.lower(), f"Reset was not confirmed: {message!r}"
        tc.shot("reset-confirmed")

        # 4. the new password actually works
        driver.execute_script("localStorage.clear();")
        outcome = auth.ui_login(driver, email, new_password, pages.LOGIN,
                                expect_url_fragment="landing.html")
        assert outcome == "session", \
            f"Could not log in with the new password: {auth.notice_message(driver)}"
        tc.note("Logged in successfully with the new password")
    finally:
        # Put the canonical test password back so the rest of the run works.
        db.reseed()


# ===========================================================================
# TC-PO-F04  Book an Appointment
# ===========================================================================


@testcase(
    "TC-PO-F04", "Book an Appointment",
    "The four-step booking form submits and the appointment is recorded as pending",
    category="functional", role="owner",
)
def test_book_appointment_four_steps(as_owner, driver, tc, mutating):
    as_owner(pages.BOOK_APPOINTMENT)

    booking = flows.book_appointment(driver)
    tc.measure("requested", f"{booking['date']} {booking['slot']}")
    tc.measure("reference", booking["reference"])
    tc.measure("progress_indicator", booking["eyebrow"])
    tc.shot("confirmation")

    # The eyebrow is upper-cased by CSS, so compare case-insensitively.
    assert "step 1 of 4" in booking["eyebrow"].lower(), \
        f"The wizard should open on step 1 of 4; it said {booking['eyebrow']!r}"
    assert booking["review_pet_name"] == booking["pet_name"], \
        "The review step should echo back the pet name that was entered"

    # -- and it is pending, awaiting the veterinarian ---------------------
    stored = db.latest_appointment(config.OWNER_EMAIL)
    assert stored, "No appointment row was created for this owner"
    tc.measure("stored_status", stored["status"])
    assert stored["status"].lower() in ("pending", "pending_confirmation"), (
        "A new booking must wait for veterinarian confirmation, "
        f"but it was stored as {stored['status']!r}"
    )


# ===========================================================================
# TC-PO-F05  Lost and Found report submission
# ===========================================================================


@testcase(
    "TC-PO-F05", "Lost and Found Report Submission",
    "A lost-pet report is accepted and the four-step success screen is shown",
    category="functional", role="owner",
)
def test_submit_lost_pet_report(as_owner, driver, tc, mutating):
    as_owner(pages.LOST_FOUND)

    click(driver, (By.CSS_SELECTOR, ".btn-report.light"))  # Report a Lost Pet
    visible(driver, (By.ID, "reportModal"), timeout=15)
    assert "Lost" in text_of(driver, (By.ID, "modalTitle"))

    pet_name = f"SEL-{int(time.time()) % 100000}"
    type_into(driver, (By.ID, "petNameInput"), pet_name)
    select_by_text(driver, (By.ID, "speciesInput"), "Dog")
    type_into(driver, (By.ID, "breedInput"), "Aspin")
    click(driver, (By.XPATH, "//button[@class='sex-btn'][normalize-space()='Male']"))
    select_first_real_option(driver, (By.ID, "sizeInput"))

    # The colour/markings field carries the cleanup tag.
    type_into(driver, (By.ID, "markingsInput"),
              f"Brown with white chest {config.SEL_TAG}")
    set_date(driver, (By.ID, "incidentDateInput"), datetime.date.today().isoformat())
    select_first_real_option(driver, (By.ID, "barangayInput"))

    from support.helpers import png_fixture, vb_alert_message

    driver.find_element(By.ID, "petPhoto").send_keys(png_fixture("lost-pet.png"))

    # Contact details are required by submitReport() even for a logged-in
    # owner - "Use Account Information" only prefills them.
    type_into(driver, (By.ID, "contactName"), "Automation Petowner")
    type_into(driver, (By.ID, "contactPhone"), "09171234567")
    type_into(driver, (By.ID, "contactEmail"), config.OWNER_EMAIL)

    tc.shot("report-form")
    click(driver, (By.CSS_SELECTOR, "#reportModal .btn-submit"))

    # -- the success screen and its four-step explainer -------------------
    # Validation failures surface through the shared vbAlert overlay, so watch
    # for both outcomes and report whichever arrives.
    def submitted_or_rejected(d):
        if is_displayed(d, (By.ID, "lostSuccessModal")):
            return "ok"
        problem = vb_alert_message(d)
        return f"rejected: {problem}" if problem else False

    result = wait(driver, 30).until(submitted_or_rejected)
    if result != "ok":
        tc.shot("rejected")
        raise AssertionError(f"The report was not accepted - {result}")
    steps = [
        el.text.strip()
        for el in driver.find_elements(By.CSS_SELECTOR, "#lostSuccessModal .step-title")
    ]
    tc.measure("success_steps", " / ".join(steps))
    tc.shot("success-screen")

    expected_steps = ["Admin Review", "Matching", "Public Posting", "You'll Get Notified"]
    for expected in expected_steps:
        assert any(expected.lower() in s.lower() for s in steps), (
            f"The success screen should explain step {expected!r}; it showed {steps}"
        )

    # -- queued for moderation, not live on the public board --------------
    stored = db.latest_lf_report(config.OWNER_EMAIL)
    assert stored, "No lost-and-found report row was created"
    tc.measure("stored_status", stored["status"])
    tc.measure("case_number", stored["case_number"])
    assert stored["status"] == "pending", (
        "A new report must queue for admin review before going public, "
        f"but it was stored as {stored['status']!r}"
    )


# ===========================================================================
# TC-PO-F06  Chatbot inquiry and consultation
# ===========================================================================


def _drive_consultation(driver, deadline: float = 120) -> tuple[str, list[str]]:
    """Answers the consultation interview until an assessment comes back.

    Returns (recommendation text, the labels that were chosen).
    """
    answered: list[str] = []
    end = time.time() + deadline

    def fresh(css: str):
        return [
            el for el in driver.find_elements(By.CSS_SELECTOR, css)
            if el.is_displayed() and "selected" not in (el.get_attribute("class") or "")
        ]

    while time.time() < end:
        boxes = driver.find_elements(By.CSS_SELECTOR, "#consultMessages .chat-info-box")
        if boxes:
            return boxes[-1].text, answered

        # multi-select symptom checklist, then Continue
        symptoms = fresh("#consultOptions .symptom-check-btn")
        continues = driver.find_elements(By.CSS_SELECTOR, "#consultOptions .symptom-continue-btn")
        if symptoms and continues:
            driver.execute_script("arguments[0].click();", symptoms[0])
            answered.append(symptoms[0].text.strip() or "symptom")
            driver.execute_script("arguments[0].click();", continues[0])
            time.sleep(0.5)
            continue

        # single-choice chips (age group, duration, severity)
        chips = fresh("#consultOptions .chip-btn")
        if chips:
            answered.append(chips[0].text.strip())
            driver.execute_script("arguments[0].click();", chips[0])
            time.sleep(0.5)
            continue

        # icon option buttons (pet type, barangay)
        options = fresh("#consultOptions .option-btn")
        if options:
            answered.append(options[0].text.strip().splitlines()[0])
            driver.execute_script("arguments[0].click();", options[0])
            time.sleep(0.5)
            continue

        time.sleep(0.3)

    raise AssertionError(
        "The consultation never produced an assessment. "
        f"Answered so far: {answered}"
    )


@testcase(
    "TC-PO-F06", "Chatbot Inquiry and Consultation",
    "Both tabs work: an inquiry returns its information, a consultation returns a recommendation",
    category="functional", role="owner",
)
def test_chatbot_inquiry_and_consultation(as_owner, driver, tc):
    as_owner(pages.LANDING)

    click(driver, (By.ID, "chatbotFab"))
    visible(driver, (By.ID, "chatbotPanel"), timeout=15)
    assert is_displayed(driver, (By.ID, "tabInquiry")), "Inquiry tab is missing"
    assert is_displayed(driver, (By.ID, "tabConsultation")), "Consultation tab is missing"
    tc.shot("chatbot-open")

    # -- Inquiry: pick Clinic Schedule and read the answer ----------------
    schedule = wait(driver, 20).until(
        lambda d: next(
            (b for b in d.find_elements(By.CSS_SELECTOR, "#inquiryOptions .option-btn")
             if "clinic schedule" in b.text.lower()),
            False,
        )
    )
    driver.execute_script("arguments[0].click();", schedule)

    wait(driver, 20).until(
        lambda d: len(d.find_elements(By.CSS_SELECTOR, "#inquiryMessages .chat-info-box")) > 0
    )
    answer = driver.find_element(By.CSS_SELECTOR, "#inquiryMessages .chat-info-box").text
    tc.measure("inquiry_answer_chars", len(answer))
    assert len(answer) > 20, f"The Clinic Schedule answer looks empty: {answer!r}"
    tc.note(f"Inquiry answer began: {answer.splitlines()[0][:60]!r}")

    # -- Consultation ------------------------------------------------------
    # The consultation is a multi-step interview: pet type, age group,
    # symptoms, duration, severity, barangay. Each step re-renders
    # #consultOptions with a different control and inserts a typing delay in
    # between, so this answers whatever is currently on screen rather than
    # assuming a fixed sequence - which is both more robust and closer to how
    # a person actually uses it.
    click(driver, (By.ID, "tabConsultation"))
    recommendation, path = _drive_consultation(driver)
    tc.note("Answered: " + " -> ".join(path))
    tc.measure("recommendation_chars", len(recommendation))
    tc.shot("consultation-result")
    assert len(recommendation) > 20, f"Empty consultation result: {recommendation!r}"

    lowered = recommendation.lower()
    assert any(word in lowered for word in
               ("home care", "book", "appointment", "emergency", "clinic", "vet", "monitor")), (
        "The consultation should recommend a concrete next action; it said "
        f"{recommendation[:160]!r}"
    )


# ===========================================================================
# TC-PO-F07  Appointment booking history
# ===========================================================================


@testcase(
    "TC-PO-F07", "View Appointment Booking History",
    "The owner's appointments are listed with their status labels and details",
    category="functional", role="owner",
)
def test_appointment_history_lists_statuses(as_owner, driver, tc):
    as_owner(pages.BOOK_APPOINTMENT)

    click(driver, (By.ID, "btnViewAll"))
    wait(driver, 20).until(
        lambda d: "active" in d.find_element(By.ID, "pageHistory").get_attribute("class")
    )

    # Either the list fills in, or the page says there is nothing yet - both
    # are correct behaviour, and only one of them can be true at a time.
    wait(driver, 25).until(
        lambda d: is_displayed(d, (By.ID, "histList")) or is_displayed(d, (By.ID, "histEmpty"))
    )

    if is_displayed(driver, (By.ID, "histEmpty")):
        tc.note("This owner has no appointments yet - empty state shown instead of a list")
        tc.shot("history-empty")
        pytest.skip("No appointment history for the test account; run TC-PO-F04 first")

    cards = driver.find_elements(By.CSS_SELECTOR, "#histList .appt-card, #histList > *")
    tc.measure("appointments_listed", len(cards))
    assert cards, "The history list is displayed but contains no entries"

    body = driver.find_element(By.ID, "histList").text
    known_statuses = ["pending", "confirmed", "completed", "rescheduled", "cancelled"]
    found = [s for s in known_statuses if s in body.lower()]
    tc.measure("status_labels_present", ", ".join(found) or "none")
    assert found, (
        "No recognisable status label appeared in the appointment history. "
        f"Text began: {body[:200]!r}"
    )
    tc.shot("history")


# ===========================================================================
# TC-PO-F08  Account profile update
# ===========================================================================


@testcase(
    "TC-PO-F08", "Account Profile Update",
    "Edited profile details are saved and still shown after a reload",
    category="functional", role="owner",
)
def test_profile_update_persists(as_owner, driver, tc, mutating):
    as_owner(pages.ACCOUNT_SETTINGS)

    phone_field = (By.ID, "inputPhone")
    visible(driver, phone_field, timeout=20)
    wait(driver, 20).until(
        lambda d: d.find_element(By.ID, "inputFullName").get_attribute("value").strip() != ""
    )
    original = driver.find_element(*phone_field).get_attribute("value")

    # A different, still-valid PH mobile number.
    new_phone = "09181234567" if original.strip() != "09181234567" else "09171234567"
    type_into(driver, phone_field, new_phone)
    tc.measure("phone_before", original)
    tc.measure("phone_after", new_phone)

    click(driver, (By.ID, "btnSaveProfile"))

    # The page confirms with its own toast rather than an alert.
    toast = wait(driver, 25).until(
        lambda d: (d.find_element(By.ID, "toast").text or "").strip() or False
    )
    tc.measure("confirmation", toast)
    tc.shot("saved")
    assert "fail" not in toast.lower() and "error" not in toast.lower(), \
        f"Saving the profile reported a problem: {toast!r}"

    # Reload: the change has to survive the round trip, not just the DOM.
    driver.refresh()
    dismiss_overlays(driver)
    visible(driver, phone_field, timeout=20)
    wait(driver, 20).until(
        lambda d: d.find_element(*phone_field).get_attribute("value").strip() != ""
    )
    reloaded = driver.find_element(*phone_field).get_attribute("value").strip()
    assert reloaded.endswith(new_phone[-9:]), (
        f"The saved number did not persist: expected {new_phone}, page shows {reloaded!r}"
    )
