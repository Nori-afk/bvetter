"""Reusable multi-step journeys, shared between test cases.

TC-PO-F04 books an appointment because booking is the thing under test.
TC-VT-F02 needs a pending appointment to exist before it can accept one. Both
want the same eleven form fields filled the same way, so the mechanics live
here and each test keeps its own assertions.
"""

from __future__ import annotations

import datetime
import time

from . import config
from .helpers import (
    By,
    click,
    is_displayed,
    select_by_text,
    select_first_real_option,
    set_date,
    text_of,
    type_into,
    wait,
)


def next_weekday(days_ahead: int = 3) -> str:
    """An ISO date the booking form will accept - weekends are rejected."""
    day = datetime.date.today() + datetime.timedelta(days=days_ahead)
    while day.weekday() >= 5:
        day += datetime.timedelta(days=1)
    return day.isoformat()


def choose_vet(driver, name_fragment: str) -> str | None:
    """Selects a named veterinarian on the booking page, if they are listed.

    Matters because the vet portal's pending list is filtered by
    `veterinarian_id` - an appointment booked with whichever vet happens to be
    first in the list is invisible to the vet the test then logs in as.
    Returns the name that was selected, or None if that vet is not bookable.
    """
    wait(driver, 25).until(
        lambda d: len(d.find_elements(By.CSS_SELECTOR, ".vet-item")) > 0
    )
    for item in driver.find_elements(By.CSS_SELECTOR, ".vet-item"):
        if name_fragment.lower() in item.text.lower():
            driver.execute_script("arguments[0].click();", item)
            time.sleep(1.0)  # slot availability refetches for the new vet
            return item.text.strip().splitlines()[0]
    return None


def book_appointment(driver, owner_email: str | None = None,
                     vet_name: str | None = None) -> dict:
    """Drives the four-step booking wizard from an already-open page.

    The caller must already be on book-appointment.html with an owner session.
    Pass `vet_name` to book with a specific veterinarian.
    Returns what was entered, so the caller can assert against it.
    """
    owner_email = owner_email or config.OWNER_EMAIL
    pet_name = f"SEL-{int(time.time()) % 100000}"
    chosen_vet = None

    # A half-finished wizard is restored from sessionStorage on load, which
    # would drop us into the middle of the form with #btnBook hidden behind
    # the wizard view. Start from a clean slate.
    if driver.execute_script("return !!sessionStorage.getItem('bvetter_booking_draft');"):
        driver.execute_script("sessionStorage.removeItem('bvetter_booking_draft');")
        driver.refresh()
        wait(driver, 20).until(
            lambda d: d.execute_script("return document.readyState === 'complete';")
        )

    if vet_name:
        chosen_vet = choose_vet(driver, vet_name)

    click(driver, (By.ID, "btnBook"))
    wait(driver, 15).until(lambda d: is_displayed(d, (By.ID, "step1")))
    eyebrow = text_of(driver, (By.ID, "bookingEyebrow"))

    # Step 1 - owner
    type_into(driver, (By.ID, "ownerName"), "Automation Petowner")
    type_into(driver, (By.ID, "ownerContact"), "09171234567")
    type_into(driver, (By.ID, "ownerEmail"), owner_email)
    barangay = select_first_real_option(driver, (By.ID, "ownerBarangay"))
    type_into(driver, (By.ID, "ownerAddress"), "1 Automation St., Purok 1")
    click(driver, (By.ID, "s1Next"))

    # Step 2 - pet
    wait(driver, 10).until(lambda d: is_displayed(d, (By.ID, "step2")))
    type_into(driver, (By.ID, "petName"), pet_name)
    select_by_text(driver, (By.ID, "petType"), "Dog")
    type_into(driver, (By.ID, "petBreed"), "Aspin")
    type_into(driver, (By.ID, "petAgeValue"), "3")
    select_by_text(driver, (By.ID, "petSex"), "Male")
    click(driver, (By.ID, "s2Next"))

    # Step 3 - appointment
    wait(driver, 10).until(lambda d: is_displayed(d, (By.ID, "step3")))
    select_by_text(driver, (By.ID, "visitType"), "Consultation")

    # Walk forward until a weekday with a free slot turns up. Repeated runs
    # fill a single day's eight slots, and a suite that starts failing on its
    # fourth run because of its own history is testing the wrong thing.
    appointment_date = None
    slots: list = []
    for offset in range(3, 32):
        candidate = next_weekday(offset)
        set_date(driver, (By.ID, "apptDate"), candidate)
        time.sleep(0.6)  # the slot grid re-renders from an availability fetch
        slots = [
            button
            for button in driver.find_elements(By.CSS_SELECTOR, "#step3 .slot-btn")
            if button.is_enabled() and "disabled" not in (button.get_attribute("class") or "")
        ]
        if slots:
            appointment_date = candidate
            break

    if not slots:
        raise AssertionError(
            "No bookable slot was offered on any weekday in the next month - the "
            "calendar is fully booked, or the availability lookup is failing"
        )
    driver.execute_script("arguments[0].click();", slots[0])
    slot = slots[0].get_attribute("data-slot")

    type_into(driver, (By.ID, "apptNotes"), f"{config.SEL_TAG} automated booking check")
    click(driver, (By.ID, "s3Next"))

    # Step 4 - review and confirm
    wait(driver, 10).until(lambda d: is_displayed(d, (By.ID, "step4")))
    review_pet = text_of(driver, (By.ID, "rv-petname"))
    click(driver, (By.ID, "s4Confirm"))

    wait(driver, 30).until(lambda d: is_displayed(d, (By.ID, "step5")))
    reference = text_of(driver, (By.ID, "rv-refNo"))

    return {
        "pet_name": pet_name,
        "review_pet_name": review_pet,
        "barangay": barangay,
        "date": appointment_date,
        "slot": slot,
        "reference": reference,
        "eyebrow": eyebrow,
        "vet": chosen_vet,
    }
