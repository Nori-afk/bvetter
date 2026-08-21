# BVetter — Selenium test suite

Automated coverage of the BVetter test plan: **Functionality**, **Performance**,
**Security** and **Usability**, for all three roles (Pet Owner, Veterinarian,
Admin). Every test is tied to a Test Case ID from the plan, and each run
produces a report organised by those IDs rather than by Python function names.

Selenium WebDriver drives a real Chrome against the app running under XAMPP —
no mocks, no stubs, no test doubles for the application itself.

---

## 1. Setup (once)

```bash
# 1. Install the Python dependencies
py -m pip install -r tests/selenium/requirements.txt

# 2. Create the three dedicated test accounts
php tests/selenium/support/seed.php
```

That's it. Chrome must be installed; Selenium Manager downloads the matching
chromedriver by itself.

**Why dedicated accounts.** `api/config/login_security.php` blocks an account
after **three** consecutive wrong passwords, and the security cases submit wrong
passwords deliberately. Pointing those at a real vet or admin login would lock a
person out of the system. The seeder creates:

| Email                          | Role         |
| ------------------------------ | ------------ |
| `selenium.owner@bvetter.test`  | pet_owner    |
| `selenium.vet@bvetter.test`    | veterinarian |
| `selenium.admin@bvetter.test`  | admin        |

all with the password `Qz7#mVr9Tb2!`, validated against the app's own live
password policy before it is written. Remove them again with:

```bash
php tests/selenium/support/seed.php --remove
```

---

## 2. Running

```bash
py -m pytest tests/selenium                      # everything
py -m pytest tests/selenium --headed             # watch it happen
py -m pytest tests/selenium -m security          # one category
py -m pytest tests/selenium -m "vet and functional"
py -m pytest tests/selenium -k lost_found        # by name
py -m pytest tests/selenium --no-mutate          # read-only: skip every writer
```

### Options

| Flag                     | What it does |
| ------------------------ | ------------ |
| `--headed`               | Show the browser instead of running headless. |
| `--slow`                 | Pause between tests — pair with `--headed` for a live demo. |
| `--no-mutate`            | Skip every test that writes to the database. |
| `--keep-data`            | Don't delete the `[SELENIUM]`-tagged rows at the end. |
| `--write-live`           | Also run the steps that **persist** changes to live data — new patients, visit logs, vaccination events, website settings. Off by default (see §5). |
| `--bypass-sw`            | Unregister the service worker before each page load, to test the pages underneath the sw.js/CSP defect (see §6). |
| `--base-url URL`         | Point the run at another host — see §4a. |
| `--allow-remote-writes`  | Permit the writing tests against a remote host. Off by default. |

---

## 4a. Running against production (bvetter.me)

```bash
py -m pytest tests/selenium --base-url https://bvetter.me
```

The suite recognises a non-localhost target and changes its own behaviour, so
this is safe to run without thinking about it:

- **Writes are refused.** Every `mutating` test skips. Against production those
  steps would create real appointments, real lost-and-found reports and real
  accounts, and the app would email real people about them. `--allow-remote-writes`
  overrides it, deliberately and explicitly.
- **The database helper is not used.** `dbq.php` talks to the *local* database;
  against a remote host its codes and tokens belong to a different installation.
  Cases that need it (the emailed OTP, the reset token, the session clock) skip
  with that reason rather than asserting against the wrong rows. Cleanup is
  never run remotely either.
- **Admin cases skip entirely**, because admin login is gated by an email 2FA
  code that only the target's database holds.

Credentials come from the environment. Without them, the logged-in cases skip:

```bash
set BVETTER_OWNER_EMAIL=someone@example.com
set BVETTER_OWNER_PASSWORD=...
set BVETTER_VET_EMAIL=...
set BVETTER_VET_PASSWORD=...
py -m pytest tests/selenium --base-url https://bvetter.me
```

**What runs with no credentials at all** — 11 cases, entirely read-only: the four
deployment checks, landing-page performance, registration-form usability, the
three invalid-credential cases, and the two unauthenticated-access cases
(pages *and* their APIs).

### Deployment checks (TC-ENV-01..04)

These four are **not in the written test plan**. They exist because every
security case in the plan assumes the deployment is configured the way the
repository says, and the same code is served by two very different Apache
setups. They check that the security headers `.htaccess` declares are actually
sent, that the files it denies are really unreachable, that HTTP redirects to
HTTPS, and that the CDN libraries the dashboards need can load on *that* host.

### Markers

`functional` · `performance` · `security` · `usability` · `owner` · `vet` ·
`admin` · `mutating`

---

## 3. What comes out

Everything lands in `tests/selenium/reports/`:

| File                    | What it is |
| ----------------------- | ---------- |
| `report.html`           | Self-contained page, grouped by category, one row per Test Case ID with verdict, timing, measured values and notes. Open it in a browser. |
| `results.csv`           | The same table — paste straight into the documentation matrix. |
| `results.json`          | Machine-readable, for charting or diffing runs. |
| `screenshots/`          | A capture at each decisive moment, plus one on every failure. |
| `downloads/`            | Files the export tests actually downloaded, kept as evidence. |

The report also records the environment each run was taken in: base URL,
browser, idle-timeout setting, whether the ARIMA service was up, and whether
the CDN was reachable — so a figure can always be read in context.

---

## 4. Coverage

### Functionality

| ID | Covered | Notes |
| -- | ------- | ----- |
| TC-PO-F01 | Full | Registration incl. the email-OTP gate and the proof upload; asserts the account lands as `inactive` / `pending`. |
| TC-PO-F02 | Full | |
| TC-PO-F03 | Full | Reset token read from `password_reset_tokens` (see §7). |
| TC-PO-F04 | Full | All four steps; asserts the row is stored `pending`. |
| TC-PO-F05 | Full | Asserts the four-step success screen and `status = pending`. |
| TC-PO-F06 | Full | Inquiry answer + the whole consultation interview through to a recommendation. |
| TC-PO-F07 | Full | Skips with a note if the account has no history yet. |
| TC-PO-F08 | Full | Asserts the edit survives a reload, not just the DOM. |
| TC-VT-F01 | Full | Also asserts the admin-only modules stay hidden from a vet. |
| TC-VT-F02 | Full | Books its own appointment first, so it never acts on a real one. |
| TC-VT-F03 | Partial | Search, filters, statistics and the full new-patient form. Saving needs `--write-live`. |
| TC-VT-F04 | Full | |
| TC-VT-F05 | Partial | Statistics, charts, event list, create-event form. Saving needs `--write-live`. |
| TC-VT-F06 | Partial | Both tabs and the review controls. The Jaccard score is only asserted when a match actually exists. |
| TC-VT-F07 | Full | |
| TC-VT-F08 | Full | Both exports are downloaded and the CSV is opened and read. |
| TC-AD-F01 | Full | Includes the email-2FA challenge (see §7). |
| TC-AD-F02 | Full | Creates a throwaway account and blocks *that*, never a real one. |
| TC-AD-F03 | Partial | Every section and control verified. Saving needs `--write-live` (it then restores the original text). |
| TC-AD-F04 – F07 | Full | |

### Performance

All fifteen cases are measured. Each records `rendered_s` (wall clock until the
content the case names is actually on screen), `nav_load_s` (the browser's own
load event) and, for submissions, `server_request_s` — how much of the wait was
the API round trip. TC-AD-P03 needs `--write-live`, since timing a save means
performing one.

### Security

All fifteen cases, each checked at **both** layers: the page guard that
redirects the browser, *and* the endpoint response. A redirect is what a user
sees; it is not what protects the data.

Session-timeout cases (TC-**-S04) move `user_sessions.last_seen_at` backwards
rather than idling for ten real minutes — the same state an abandoned tab
reaches, arrived at in a second.

### Usability

The objective conditions that usability judgements rest on: labelled fields,
specific and visible validation messages, a visually distinct current
page/tab/step, descriptive headings and column headers, no sideways scrolling,
no broken images. Every case also carries a **"Still needs a human"** note
naming the part no assertion can answer. Read the two together.

---

## 5. What the suite writes, and what it never touches

Writers are marked `mutating` and skipped by `--no-mutate`.

Everything the suite creates carries the tag `[SELENIUM]` or a
`selenium.*@bvetter.test` address, and is deleted at the end of the run. The
cleanup only ever matches those — it cannot reach real beta data:

- appointments whose notes contain `[SELENIUM]`
- lost-and-found reports whose markings or notes contain `[SELENIUM]`
- users matching `selenium.reg.%` / `selenium.acct.%@bvetter.test`

**Off by default, behind `--write-live`:** saving a patient or visit log, creating
a vaccination event, and saving website settings. Those rows feed
`patient_visit_records` and the vaccination series — the inputs to the disease
analytics and the ARIMA forecast — and site settings change what the public
landing page shows. Running the suite should not quietly move the numbers the
research reports.

Take a backup before a `--write-live` run: `php database/backup.php`.

---

## 6. Known conditions this suite reports on

Some cases fail because the application, not the test, is at fault. They are
listed here so a red row is not mistaken for a broken test.

### Still open

1. **Submissions are slow because email is sent inside the request.** One
   `sendAppMail()` takes ~3.5s against Gmail SMTP. A booking sends four —
   `notifyStaff(..., emailImportant: true)` emails every `staffAlertRecipients`
   row plus the owner — so the endpoint spends ~15s before answering
   (TC-PO-P03, TC-PO-P04, TC-AD-P04). Options, cheapest first: switch to the
   Brevo HTTPS API (`mailer.php` already branches on `BREVO_API_KEY`); send
   after the response; queue and drain from cron; or reduce the fan-out.
   Production may already be on Brevo, in which case this number is local-only —
   a remote run with credentials would settle it.
2. **Production sends none of the security headers `.htaccess` declares**
   (TC-ENV-01). No Content-Security-Policy, X-Frame-Options,
   X-Content-Type-Options or Referrer-Policy on bvetter.me, and no
   Strict-Transport-Security either. The `<IfModule mod_headers.c>` guard around
   that block means a server without `mod_headers` drops all of it silently — no
   error, nothing in the log. The `<FilesMatch>` deny rules in the same file DO
   work there (TC-ENV-02 passes), which is what makes it easy to assume the rest
   of the file is in effect. Fix: `sudo a2enmod headers && sudo systemctl reload
   apache2` — **only after the `sw.js` fix below is deployed**, or the CSP will
   start applying and blank every chart.
3. **The ARIMA forecast needs the Flask service.** Without
   `py api/analytics/arima_service.py` running on 127.0.0.1:5001, the forecast
   endpoint answers 502 and falls back. The suite detects this and says so
   instead of blaming the chart.

### Fixed on 2026-08-21 (found by this suite)

- **`sw.js` blocked every CDN library.** It re-issued all requests with
  `fetch(event.request)`, and the worker inherits the page CSP's
  `connect-src 'self'` — so Chart.js, FullCalendar, Leaflet, Lucide and Google
  Fonts could not load once a service worker took control. No charts, no
  calendar, no maps, for every user. Now returns early for cross-origin
  requests; the worker still registers and controls, so the PWA install
  criteria are unaffected. **Not yet deployed to bvetter.me** — and it must go
  out before `mod_headers` is enabled there (see 2 above).
- **The 6-second analytics stall.** `analytics_service_urls()` trailed a
  hardcoded LAN address (`192.168.1.25:5001`) which, off that one machine, is
  filtered rather than refused — so every dashboard scope waited out the full
  3-second connect timeout reaching for it, twice over. 6.15s → 0.96s.
  Disease Analytics 6.74s → **1.54s**, Mass Vaccination 6.29s → **1.15s**.
- **Forgot Password was dead on any sub-folder install.**
  `forgot-password.html` and `reset-password.html` posted to `/api/...` without
  loading `shared/js/auth.js`, which is what rebases those paths. Both now load
  it for the fetch wrapper.
- **`renderProofPreview` was called and never defined** (`signup.js`), so
  registration step 3 threw and `updateStepper(3)` never ran. Now implemented as
  a sibling of `updateProofPreview()`.

`--bypass-sw` remains available for testing the pages underneath a service
worker, but is no longer needed to get a green run.

---

## 7. Where the harness stands in for the world

Three things a browser genuinely cannot do are supplied by
`support/dbq.php`, a CLI-only helper with a whitelisted set of queries:

- **Reading an emailed code.** Admin login is gated by email 2FA
  (`security_settings.two_factor_enabled`), registration by an email OTP, and
  password reset by an emailed token. The harness reads those from the database
  instead of opening a mailbox.
- **Waiting out a timeout.** The idle window is ten minutes; the harness moves
  `last_seen_at` instead.
- **Asserting what the UI does not show.** e.g. that a new booking really is
  stored as `pending`.

It talks to the database through the app's own `api/config/connection.php`, so
credentials live in exactly one place and a test run cannot drift from what the
application is connected to.

---

## 8. Layout

```
tests/selenium/
├── conftest.py                  fixtures, preflight, reporting
├── pytest.ini                   markers
├── requirements.txt
├── test_functional_petowner.py  TC-PO-F01..F08
├── test_functional_vet.py       TC-VT-F01..F08
├── test_functional_admin.py     TC-AD-F01..F07
├── test_performance.py          TC-**-P**
├── test_security.py             TC-**-S**
├── test_usability.py            TC-**-U**
├── support/
│   ├── auth.py                  logins, session capture and re-use
│   ├── config.py                URLs, credentials, budgets (env-overridable)
│   ├── db.py                    Python wrapper around dbq.php
│   ├── dbq.php                  the whitelisted DB helper
│   ├── flows.py                 journeys shared between cases
│   ├── helpers.py               waits, timing, evidence, DOM utilities
│   ├── marks.py                 the @testcase decorator
│   ├── pages.py                 every URL in one place
│   ├── report.py                the HTML/CSV/JSON report builder
│   └── seed.php                 the three test accounts
├── fixtures/                    generated upload files (not committed)
└── reports/                     output (not committed)
```

## 9. Troubleshooting

**"PREFLIGHT FAILED — the app is not being served"** — start Apache in the XAMPP
control panel, or pass `--base-url`.

**"PREFLIGHT FAILED — the test account does not exist"** — run
`php tests/selenium/support/seed.php`.

**Login fails after a security run** — a wrong-password test should never touch a
real account, but if an account is blocked, re-running the seeder clears the
lockout on the three test accounts.

**Everything is slow** — the first run downloads chromedriver. Later runs reuse it.
