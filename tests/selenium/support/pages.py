"""Every page URL the suite touches, in one place.

Keeping them here means a folder rename is a one-line fix rather than a
find-and-replace across every test file.
"""

from __future__ import annotations

from .config import BASE_URL


def url(path: str) -> str:
    return f"{BASE_URL}/{path.lstrip('/')}"


# -- public / pet owner -----------------------------------------------------
LANDING = url("public/pages/landing.html")
LOGIN = url("public/pages/login.html")
REGISTER = url("public/pages/create-account.html")
FORGOT_PASSWORD = url("public/pages/forgot-password.html")
RESET_PASSWORD = url("public/pages/reset-password.html")
BOOK_APPOINTMENT = url("public/pages/book-appointment.html")
LOST_FOUND = url("public/pages/lost-found.html")
MY_PETS = url("public/pages/my-pets.html")
MY_CLAIMS = url("public/pages/my-claims.html")
ACCOUNT_PROFILE = url("public/pages/account-profile.html")
ACCOUNT_SETTINGS = url("public/pages/account-settings.html")

# -- veterinarian -----------------------------------------------------------
VET_DASHBOARD = url("vet/html/index.html")
VET_APPOINTMENTS = url("vet/html/appointment.html")
VET_PATIENT_RECORDS = url("vet/html/patient-records.html")
VET_DISEASE_ANALYTICS = url("vet/html/disease-analytics.html")
VET_MASS_VACCINATION = url("vet/html/mass-vaccination.html")
VET_LOST_FOUND = url("vet/html/lost-and-found.html")
VET_CHATBOT_MGMT = url("vet/html/chatbot-management.html")
VET_REPORT = url("vet/html/report.html")
VET_PROFILE = url("vet/html/profile.html")

# -- admin ------------------------------------------------------------------
# The admin door is deliberately unlinked from the public site
# (see api/auth/login.php); the path comes from shared/js/auth.js.
ADMIN_LOGIN = url("admin/pages/ops-3bab26d632.html")
ADMIN_DASHBOARD = url("admin/pages/index.html")
ADMIN_ACCOUNTS = url("admin/pages/account-management.html")
ADMIN_WEBSITE = url("admin/pages/website-management.html")
ADMIN_SECURITY = url("admin/pages/manage-security.html")
ADMIN_PROFILE = url("admin/pages/profile.html")

# -- api --------------------------------------------------------------------
API_LOGIN = url("api/auth/login.php")
API_ADMIN_LOGIN = url("api/auth/admin-login.php")
API_SESSION = url("api/auth/session.php")
API_PATIENT_RECORDS = url("api/patient-records/patient_records.php")
API_ACCOUNT_MGMT = url("api/admin/account-management.php")
API_SITE_SETTINGS = url("api/site-settings/site-settings.php")
API_REPORTS = url("api/reports/reports.php")
API_LOST_FOUND = url("api/lost-found/lost_and_found.php")
API_DASHBOARD = url("api/dashboard/dashboard.php")


#: Pages a pet owner must never reach (TC-PO-S03) - vet + admin modules.
VET_ONLY_PAGES = [
    ("Vet dashboard", VET_DASHBOARD),
    ("Patient Records", VET_PATIENT_RECORDS),
    ("Disease Analytics", VET_DISEASE_ANALYTICS),
    ("Mass Vaccination", VET_MASS_VACCINATION),
    ("Vet Report", VET_REPORT),
]

#: Pages only an admin may reach (TC-VT-S02, TC-AD-S02, TC-AD-S03).
ADMIN_ONLY_PAGES = [
    ("Account Management", ADMIN_ACCOUNTS),
    ("Website Management", ADMIN_WEBSITE),
    ("Manage Security", ADMIN_SECURITY),
]
