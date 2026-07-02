# VBetter (BVETTER) Technical Manual

Audience: developers, system administrators, and IT personnel maintaining or extending the
VBetter veterinary services platform for Baliuag City. This manual documents architecture,
setup, configuration, module internals, API surface, and operational procedures.

---

## 1. System Overview

VBetter is a web-based veterinary management system composed of three portals (Public/pet
owner, Veterinarian, Administrator) backed by a PHP REST-style API, a MySQL database, and a
standalone Python analytics microservice for forecasting.

| Layer       | Technology                                                            |
|-------------|------------------------------------------------------------------------|
| Frontend    | HTML, CSS, Vanilla JavaScript (no framework/build step)                |
| Backend API | PHP 8.x, served by Apache (XAMPP)                                      |
| Database    | MySQL / MariaDB — schema in `database/bvetter.sql`                     |
| Analytics   | Python 3.13, Flask microservice — ARIMA/SARIMA (statsmodels), Random Forest (scikit-learn), SMOTE (imbalanced-learn) |
| Image match | Python — Pillow (color histogram + perceptual brightness hashing)      |
| PDF export  | mPDF (Composer package)                                                |
| Email       | PHPMailer (Composer package)                                           |

The PHP layer and the Python analytics service are **two independent processes**. The PHP API
never imports Python code directly for analytics (only for the lost-and-found image feature
extractor, which it shells out to per-request); the Flask service is called over HTTP from the
frontend/PHP using `VBETTER_ANALYTICS_URL`.

---

## 2. Directory Structure

```text
bvetter/
├── .env.example              Environment variable template — copy to .env
├── .htaccess                 Apache security headers + storage lockdown
├── composer.json / composer.lock
├── README.md
│
├── api/                              All backend endpoints (JSON in/out)
│   ├── admin/account-management.php  User/role administration, approvals
│   ├── admin/verify-contact.php      Contact verification codes
│   ├── analytics/
│   │   ├── arima_service.py          Flask analytics service (port 5001)
│   │   ├── requirements.txt
│   │   └── fig*.png                  Model evaluation figures (from test_eval.py)
│   ├── announcements/announcements.php
│   ├── appointments/appointment.php
│   ├── auth/{login,register,generate_pass}.php
│   ├── barangays/list.php
│   ├── chatbot/chatbot.php           Rule-based inquiry + consultation chatbot
│   ├── config/connection.php         PDO connection factory
│   ├── dashboard/dashboard.php
│   ├── includes/dataset.php
│   ├── lost-found/
│   │   ├── lost_and_found.php        Reports, sightings, claims, matching
│   │   ├── image_matcher.py          Standalone image feature/compare CLI
│   │   └── requirements.txt
│   ├── mass-vaccination/events.php
│   ├── patient-records/patient_records.php
│   ├── reports/reports.php
│   └── users/profile.php
│
├── database/
│   ├── bvetter.sql                   Full schema + seed data
│   └── BaliwagVet_2023-2025.xlsx     Historical dataset consumed by arima_service.py
│
├── storage/                          Gitignored, user-uploaded files
│   ├── announcements/ lost_found/ lost_found_claims/
│   ├── lost_found_sightings/ profile/ verification/
│
├── shared/                           Cross-portal frontend assets (css/html/js)
├── public/                           Pet owner portal
├── vet/                              Veterinarian portal
├── admin/                            Administrator portal
├── tests/                            Diagnostic scripts (non-production)
├── vendor/                           Composer packages — do not hand-edit
└── tmp/                              mPDF cache (gitignored)
```

`config/connection.php` is the canonical DB connection used by every endpoint under `api/`.
There is also a legacy hardcoded connection at `api/config/connection.php` (host `localhost`,
user `root`, empty-string password `root`, db `bvetter`) — **new code should use the
env-driven `config/connection.php`**, not the hardcoded one, to avoid credentials drifting
between environments.

---

## 3. Local Environment Setup

### 3.1 Prerequisites

- XAMPP (Apache + MySQL + PHP 8.x)
- Composer
- Python 3.13
- Required PHP extensions (enable in `php.ini`): `pdo_mysql`, `curl`, `mbstring`, `gd`, `zip`, `fileinfo`

### 3.2 Install steps

1. **Place the project** at `C:\xampp\htdocs\bvetter\`. If deployed elsewhere, update
   `BACKEND_URL` in `vet/js/vet-api.js` and `API_BASE_REG` in `public/js/api.js` — all frontend
   `fetch()` calls are hardcoded to `/bvetter/...` paths by default.
2. **Start Apache and MySQL** in the XAMPP control panel.
3. **Create and import the database**:
   ```sql
   CREATE DATABASE bvetter CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
   ```
   Import `database/bvetter.sql` via phpMyAdmin or:
   ```powershell
   cd C:\xampp\mysql\bin
   .\mysql.exe -u root -p -e "CREATE DATABASE bvetter CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
   .\mysql.exe -u root -p bvetter < "C:\xampp\htdocs\bvetter\database\bvetter.sql"
   ```
   **Verify the import completed.** The dump defines columns first, then adds primary keys,
   indexes, and `AUTO_INCREMENT` in trailing `ALTER TABLE` blocks. A truncated import (common
   when `max_execution_time` is too low) leaves tables with no primary key, causing `500`
   errors on any page touching the DB. Confirm with:
   ```sql
   SHOW KEYS FROM users WHERE Key_name = 'PRIMARY';
   ```
   If empty, re-run the import or manually execute everything from `-- Indexes for dumped
   tables` onward in the dump file.
4. **Configure environment variables**:
   ```powershell
   copy .env.example .env
   ```
   Key variables (`config/connection.php` reads these via `getenv()` — never hardcode
   credentials in new code):
   ```ini
   DB_HOST=127.0.0.1
   DB_PORT=3307
   DB_NAME=bvetter
   DB_USER=root
   DB_PASS=
   SMTP_HOST=
   SMTP_PORT=587
   SMTP_USER=
   SMTP_PASS=
   SMTP_FROM=
   APP_ENV=production
   APP_DEBUG=false
   APP_BASE_URL=http://localhost/bvetter
   VBETTER_ANALYTICS_URL=http://127.0.0.1:5001
   ```
5. **Install PHP dependencies**:
   ```powershell
   cd C:\xampp\htdocs\bvetter
   composer install
   ```
   Installs mPDF and PHPMailer into `vendor/`.
6. **Install Python dependencies** (recommended: virtual environment):
   ```powershell
   python -m venv .venv
   .\.venv\Scripts\Activate.ps1
   python -m pip install --upgrade pip
   pip install -r api/analytics/requirements.txt
   pip install -r api/lost-found/requirements.txt
   ```
   If PowerShell blocks script execution: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.
7. **Start the analytics service** (separate terminal, venv active):
   ```powershell
   python api/analytics/arima_service.py
   ```
   Runs on `http://localhost:5001`. Verify with `GET http://localhost:5001/health`
   (expect `{"status": "ok", ...}`). Disease analytics and vaccination forecasting are
   unavailable without this process — PHP/Apache alone cannot serve those features.
8. **Open the app**: `http://localhost/bvetter/public/pages/landing.html`

### 3.3 Run checklist

- [ ] Apache + MySQL running
- [ ] `bvetter` database created and `bvetter.sql` imported (verify PKs exist)
- [ ] `.env` present with correct DB credentials
- [ ] `composer install` completed (`vendor/` populated)
- [ ] Python venv created, both `requirements.txt` installed
- [ ] `arima_service.py` running on port 5001 and `/health` returns OK

### 3.4 Portal entry points

| Role         | Entry point                   | URL                                                    |
|--------------|--------------------------------|---------------------------------------------------------|
| Public       | `public/pages/landing.html`   | `http://localhost/bvetter/public/pages/landing.html`     |
| Veterinarian | `vet/html/index.html`         | `http://localhost/bvetter/vet/html/index.html`           |
| Admin        | `admin/pages/index.html`      | `http://localhost/bvetter/admin/pages/index.html`        |

---

## 4. Backend Architecture Conventions

Every PHP endpoint under `api/` follows the same pattern:

- Single file per module, dispatched by a single `action` field read from either JSON body or
  `$_POST` (see `inputData()` in `chatbot.php` for the canonical merge pattern).
- Responses are JSON with a `success` boolean and either `data`/`message`/`error`.
- Table creation is idempotent: modules call a `setup*Tables($pdo)` function on every request
  that runs `CREATE TABLE IF NOT EXISTS`, so first-run schema creation and drift-repair happen
  automatically without a separate migration step. Default/reference data is seeded via a
  `seedDefaults($pdo)` guarded by `COUNT(*) === 0`.
- Duplicate-row cleanup (self-join `DELETE`) runs as part of setup in some modules (e.g.
  chatbot rules) to correct any accidental double-inserts from earlier seed runs.
- Input normalization helper functions (`clean()`, `normalizeStatus()`, `normalizePetType()`,
  etc.) coerce free-form client input into the fixed vocabulary the rest of the module expects
  before it reaches SQL or scoring logic.

This means **any new API module should follow the same shape**: one dispatch file, an
`action`-based switch (implemented as sequential `if` + early `respond()`/`exit`, not a real
`switch`), idempotent setup, and normalized inputs.

---

## 5. Module Reference

### 5.1 Chatbot (`api/chatbot/chatbot.php`)

Two independent rule systems, both DB-backed and administrator-editable:

**Inquiry rules** (`chatbot_inquiry_rules`) — static Q&A entries (clinic schedule, vaccination
requirements, appointment booking, lost-and-found procedure) with an optional redirect action.
Seeded with four defaults on first run.

**Consultation rules** (`chatbot_consultation_rules`) — symptom-based triage entries keyed by
pet type, symptoms (JSON array), duration, and severity, each mapped to a condition title,
recommendation text, and action type (`home_care`, `monitor_24hrs`, `book_appointment`,
`emergency_visit`).

Matching algorithm (`scoreRule()`), used by `assess_consultation`:

| Signal            | Points        |
|-------------------|---------------|
| Pet type match (or rule is `Other`) | +2 |
| Duration match    | +2            |
| Severity match    | +2            |
| Each matching symptom | +3 each   |

The highest-scoring rule wins if its score is **≥ 4**; otherwise `fallbackAssessment()`
classifies the case using hardcoded critical-symptom checks (seizures, wounds) and
duration/symptom-count heuristics, guaranteeing a non-empty response. Every assessment is
logged to `chatbot_consultation_logs` (feeds `dashboard_stats`); every inquiry click is logged
to `chatbot_inquiry_logs`.

Key actions: `list_inquiries`, `public_inquiries`, `save_inquiry`, `delete_inquiry`,
`record_inquiry_use`, `list_consultations`, `public_consultations`, `save_consultation`,
`delete_consultation`, `assess_consultation`, `dashboard_stats`.

### 5.2 Lost & Found (`api/lost-found/lost_and_found.php`, `image_matcher.py`)

Handles three record types — lost/found **reports**, **sightings**, and ownership **claims** —
plus a matching engine that scores lost reports against found reports/sightings.

Matching algorithm (`scoreMatch()`), max 100 points:

| Signal | Method | Weight |
|---|---|---|
| Species | exact match; mismatch disqualifies the pair (score 0) | 12 |
| Breed | Jaccard similarity on free text | up to 14 |
| Sex | exact match | 8 |
| Size | exact match | 10 |
| Color/markings + notes | Jaccard similarity on free text | up to 18 |
| Location | same barangay, else haversine distance banding (≤1km/≤3km/≤7km) | up to 18 |
| Photo color profile | RGB Euclidean distance → similarity | up to 10 |
| Photo brightness pattern | Hamming similarity on a 12×12 brightness hash | up to 10 |

Every scored pair is persisted in `lost_found_matches` with its confidence score and a
human-readable `reasons` list (e.g. "Same barangay", "Similar photo color profile"), so admins
and users see *why* a match was suggested, not just a number.

`image_matcher.py` is invoked by PHP as a subprocess (`features <path>` or
`compare <left> <right>`) rather than imported, since PHP and Python run in separate runtimes.
It computes and returns (as JSON): SHA-1 of the file, average RGB, a 12×12 brightness hash, and
a 4×4×4 color histogram. If Pillow is not installed, it degrades to metadata-only output
(`engine: "python-metadata"`) — the PHP side treats missing image features as absent signals
rather than an error, so matching still works on structured attributes alone.

Key actions: `list`, `management_list`, `get`, `my_reports`, `create_report`, `approve_report`,
`reject_report`, `resolve_report`, `list_matches`, `approve_match`, `dismiss_match`,
`submit_sighting`, `list_sightings`, `approve_sighting`, `reject_sighting`,
`resolve_sighting`, `submit_claim`, `list_claims`, `management_claims`, `approve_claim`,
`reject_claim`, `resolve_claim`, `rebuild_image_features`, `get_total_reports`,
`get_active_reports`.

### 5.3 Analytics Service (`api/analytics/arima_service.py`)

Standalone Flask app (port `5001`) reading `database/BaliwagVet_2023-2025.xlsx` directly (not
via MySQL). In-memory TTL cache (`CACHE_TTL = 600s`) fronts every expensive computation.

**Vaccination forecasting** (`/vaccination-forecast`, `/vaccination-forecast-barangay`)
- Reads `Forecast_Input_Dogs_3Y` / `_Cats_3Y` / `_Clients_3Y` sheets; `total_vaccinated` is
  computed as dogs + cats to match the source workbook's own derivation.
- `run_vaccination_arima()` wraps a plain auto-ARIMA fit (`_select_arima_order()` grid-searches
  5 (p,q) combos against ADF-selected `d`) with a **regime-shift guard**: if the latest year's
  total is less than 45% of the prior years' median, or if the raw forecast collapses below a
  seasonal baseline (25th percentile / month-matched median of prior years), the forecast is
  floored to that seasonal baseline and flagged with `regime_shift` / `forecast_collapse` /
  `data_quality_note` in the response — this exists because a genuine drop in *recorded* data
  (e.g. an under-reported year) should not be read by the frontend as an actual drop in future
  demand.
- Per-barangay vaccination forecasts are **not** independently fit models — no per-barangay
  vaccination history exists in the source data. Instead, the single municipal ARIMA forecast
  is scaled by each barangay's `allocation_weight` from the `Barangay_Masterlist` sheet
  (derived from 2025 estimated dog population share). This is explicitly reported in the
  response `basis` field so the distinction from a real per-barangay model is not lost.

**All-disease hybrid** (`/disease-predict` with `disease=""` or `"all"`)
- `load_all_disease_dataframe()` builds lag/rolling/seasonal/disease-mix features per barangay
  from `Barangay_Disease_Monthly`.
- `RandomForestRegressor` forecasts `total_cases`; `RandomForestClassifier` predicts
  `risk_class`. The classifier **deliberately excludes** lag/rolling case-count features —
  including them let `lag_1` alone reconstruct the risk threshold and produced a misleading
  100% accuracy, since `total_cases` barely moves month-to-month per barangay. The classifier
  only sees seasonal signals (month sin/cos, month number, year) and disease-mix ratios.
- Train/test split is **stratified by risk_class** (not chronological) because the "Low" class
  has only 6 of 891 rows, all early in the sort order — a chronological split would have made
  "Low" invisible in evaluation.
- SMOTE oversampling is applied to the **classifier's training fold only** (never touches the
  held-out test set) to address that same "Low" class scarcity; `k_neighbors` is capped below
  the minority class count to avoid a hard SMOTE failure.
- Both models are warm-started at process boot (`get_all_disease_models()` called in `__main__`)
  so the first real request isn't slowed by training.
- ARIMA and RF results are fused per barangay (`_hybrid_predict_one_alldisease`) into a tiered
  action protocol (critical/monitor/stable) with concrete next-step recommendations
  (`_build_all_disease_protocol`).
- For `period=year`, `predicted_cases` is the **sum of 12 monthly ARIMA forecasts** (matching
  what an annual bar chart would show); for `period=month`, it's the single next-month value.

**Disease-specific forecasting** (`/disease-predict` with a named disease)
- Reads `Consult_Diagnosis_3Y`, aggregates per barangay/month, and fits SARIMA (seasonal, if
  ≥12 observations) or plain ARIMA via a reduced 4×4 grid search (`_sarima_order_search`,
  16 combos instead of 81, for latency). Falls back to a weighted moving-average with bootstrap
  confidence intervals (`_ma_fallback`, 200 resamples) when there isn't enough history.
- Risk classification here is **explicitly rule-based, not ML** — p50/p75 percentile
  thresholds per disease (`_disease_risk_thresholds`) label a barangay Low/Medium/High. This is
  reported to the frontend as `rf_model_type: "RuleBasedThreshold"` to avoid overstating it as
  a trained classifier.
- `_compute_disease_metrics()` reports MAE/RMSE/MAPE from a genuine **time-based holdout**
  (train on all but the last N months, forecast those N months, compare to actuals) — not an
  in-sample fit statistic.

**Other endpoints**: `/patient-volume-predict` (generic ARIMA over any submitted series),
`/hybrid-model-info` / `/rf-model-info` (model metadata, feature importances, evaluation
metrics), `/disease-list` (distinct diagnoses from the workbook), `/health`.

Operational notes:
- All routes are cached in-process; caches are never invalidated on data changes short of a
  process restart or TTL expiry (600s) — restart the service after updating the Excel dataset
  if you need to see changes immediately.
- The service has no authentication of its own; it is expected to run on localhost/internal
  network only and be fronted by the PHP layer, which handles user auth.

### 5.4 Other API modules

| Module | File | Key actions |
|---|---|---|
| Auth | `api/auth/{login,register,generate_pass}.php` | login, register, password reset |
| Admin | `api/admin/account-management.php` | `list`, `roles`, `create`, `delete`, `approve`, `reject` |
| Appointments | `api/appointments/appointment.php` | `list`, `create`, `update_status`, `delete`, `vets`, `booked_slots`, `submit_review`, `vet_reviews` |
| Patient records | `api/patient-records/patient_records.php` | `list`, `save`, `update`, `delete` |
| Mass vaccination | `api/mass-vaccination/events.php` | `list`, `create`, `submit_report` |
| Announcements | `api/announcements/announcements.php` | `list`, `create`, `update`, `save`, `delete` |
| Users | `api/users/profile.php` | `get`, `update`, `preferences`, `password` |
| Barangays | `api/barangays/list.php` | barangay reference list |
| Dashboard | `api/dashboard/dashboard.php` | aggregate KPIs for admin/vet dashboards |
| Reports | `api/reports/reports.php` | PDF/report generation (mPDF) |

---

## 6. Database

Full schema and seed data: `database/bvetter.sql`. Import via phpMyAdmin or MySQL CLI (see
§3.2). Character set/collation must be `utf8mb4` / `utf8mb4_unicode_ci`.

Tables are also self-healing at the application layer: most modules run
`CREATE TABLE IF NOT EXISTS` for their own tables on every request (see §4), so a partially
imported or manually-dropped table for chatbot/lost-found data will be recreated automatically
— but this does **not** apply to the core tables defined only in `bvetter.sql` (users,
appointments, patient records, etc.), which must come from the SQL dump.

`database/BaliwagVet_2023-2025.xlsx` is a separate, file-based dataset consumed only by the
Python analytics service — it is not loaded into MySQL. Relevant sheets:
`Forecast_Input_Dogs_3Y`, `Forecast_Input_Cats_3Y`, `Forecast_Input_Clients_3Y`,
`Barangay_Masterlist`, `Barangay_Disease_Monthly`, `Consult_Diagnosis_3Y`.

---

## 7. Security Notes

- `.htaccess` denies direct access to `.env`, `.git`, `composer.phar`, `composer-setup.php`,
  `bvetter.sql`, and `reset-links.log`, and blocks PHP execution under `storage/` (so an
  uploaded `.php` file cannot be executed even if it lands in an upload directory), while still
  serving static assets (images/PDFs) from `storage/` directly for `<img>`/download use.
- Security headers set: `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`,
  `X-XSS-Protection: 1; mode=block`, `Referrer-Policy: strict-origin-when-cross-origin`.
- All new DB access must use prepared statements via the shared PDO instance
  (`PDO::ATTR_EMULATE_PREPARES => false` is already set) — do not interpolate user input into
  SQL strings.
- Never commit `.env`; use `.env.example` as the template and keep real credentials local.

---

## 8. Troubleshooting

| Symptom | Cause / Fix |
|---|---|
| Database connection failed | MySQL not running, `bvetter` DB missing, or `.env` credentials wrong. `config/connection.php` reads `DB_HOST`/`DB_USER`/`DB_PASS`/`DB_NAME`/`DB_PORT` via `getenv()`. |
| API calls return 404 | Project not at `C:\xampp\htdocs\bvetter\`. Update `BACKEND_URL` (`vet/js/vet-api.js`) and `API_BASE_REG` (`public/js/api.js`) if relocated. |
| `500` on pages that touch the DB right after import | `bvetter.sql` import was truncated before its trailing `ALTER TABLE` (PK/index) block ran. Check `SHOW KEYS FROM users WHERE Key_name='PRIMARY'`; re-import if empty. |
| Disease analytics / vaccination forecast won't load | Python service not running — check `http://localhost:5001/health`. Confirm `database/BaliwagVet_2023-2025.xlsx` exists at the expected relative path. |
| Image matching returns metadata-only results (no visual similarity) | Pillow not installed — `pip install -r api/lost-found/requirements.txt` inside the active venv. |
| Port 5001 already in use | Stop the conflicting process, or change `port=5001` in `arima_service.py`'s `app.run(...)` and update every JS reference to that port. |
| Composer not found | Install from `https://getcomposer.org`, reopen terminal (PATH refresh). |
| Analytics numbers look stale after editing the Excel file | The Flask process caches responses for up to 600s and warm-starts RF models once at boot — restart `arima_service.py` after data changes. |

---

## 9. Extending the System

When adding a new backend module, mirror the existing pattern (§4):

1. One PHP file under `api/<module>/`, dispatched by a single `action` parameter read from
   merged JSON/POST input.
2. `setup<Module>Tables($pdo)` using `CREATE TABLE IF NOT EXISTS`, called at the top of every
   request, so the module self-provisions its schema.
3. Normalize all free-form input into a fixed vocabulary before it reaches SQL or business
   logic (see `normalizeStatus()`, `normalizePetType()` in `chatbot.php` for the pattern).
4. Return `{"success": bool, "data": ...}` or `{"success": false, "message": ...}` — the
   frontend JS across all three portals expects this shape.
5. If the feature needs Python (ML/image processing), keep it as either a subprocess call
   (like `image_matcher.py`) or a separate Flask endpoint (like `arima_service.py`) — do not
   attempt to run PHP and Python in the same process.
