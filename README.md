
This guide explains how to set up and run the VBetter project on a local XAMPP environment, including the MySQL database, PHP Composer dependencies, and the Python analytics service.

## Project Overview

VBetter is a PHP/MySQL web application with HTML, CSS, and JavaScript pages for public users, veterinarians, and administrators. It also uses a Python Flask service for disease analytics, ARIMA forecasting, and Random Forest prediction features.

Main folders:

```text
Final-Backend/
  admin/                 Admin pages, scripts, styles, and images
  backend/               PHP API endpoints and server-side logic
  public/                Public user pages and scripts
  shared/                Shared frontend assets
  vet/                   Veterinarian pages, scripts, styles, and images
  vendor/                Composer-installed PHP packages
  bvetter.sql            MySQL database dump
  BaliwagVet_2023-2025.xlsx
                         Dataset used by the Python analytics service
  composer.json          PHP dependency definition
```

## Requirements

Install these before running the project:

- XAMPP with Apache, MySQL, and PHP 8.x
- Composer
- Python 3.10 or newer
- A browser such as Chrome, Edge, or Firefox

Recommended PHP extensions:

- `pdo_mysql`
- `curl`
- `mbstring`
- `gd`
- `zip`
- `fileinfo`

These are normally included with XAMPP, but some may need to be enabled in `php.ini`.

## Important Folder Path

Several frontend and backend files use hardcoded local paths such as:

```text
/Final-Backend
```

For the fewest setup issues, place the project exactly here:

```text
C:\xampp\htdocs\Final-backend(VBETTER)\Final-Backend
```

If you rename the folder, search the codebase for these strings and update them:

```text
Final-backend(VBETTER)
FINAL-BACKEND(VBETTER)
Final-Backend
```

## 1. Start XAMPP

1. Open XAMPP Control Panel.
2. Start `Apache`.
3. Start `MySQL`.

Then confirm Apache works by opening:

```text
http://localhost/
```

## 2. Set Up the MySQL Database

The database dump is included as:

```text
Final-Backend\bvetter.sql
```

The application expects this database name:

```text
bvetter
```

### Option A: Import Using phpMyAdmin

1. Open:

```text
http://localhost/phpmyadmin
```

2. Create a new database named:

```text
bvetter
```

3. Select the `bvetter` database.
4. Go to the `Import` tab.
5. Choose `bvetter.sql`.
6. Click `Import`.

### Option B: Import Using Command Line

Open PowerShell or Command Prompt and run:

```powershell
cd C:\xampp\mysql\bin
.\mysql.exe -u root -p bvetter < "C:\xampp\htdocs\Final-backend(VBETTER)\Final-Backend\bvetter.sql"
```

If the database does not exist yet, create it first:

```powershell
.\mysql.exe -u root -p -e "CREATE DATABASE bvetter CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
```

## 3. Configure the Database Connection

Database settings are in:

```text
Final-Backend\backend\config\connection.php
```

Current configuration:

```php
define('DB_HOST', 'localhost');
define('DB_USER', 'root');
define('DB_PASS', 'root');
define('DB_NAME', 'bvetter');
```

If your local MySQL root user has no password, change this line:

```php
define('DB_PASS', 'root');
```

to:

```php
define('DB_PASS', '');
```

If you use a different MySQL user, update `DB_USER` and `DB_PASS`.

## 4. Install PHP Dependencies with Composer

From the project folder, run:

```powershell
cd "C:\xampp\htdocs\Final-backend(VBETTER)\Final-Backend"
composer install
```

This installs the PHP packages listed in `composer.json`.

Current Composer dependency:

```json
{
  "mpdf/mpdf": "^8.3"
}
```

If Composer is not installed globally but `composer.phar` is available, run:

```powershell
php composer.phar install
```

## 5. Install Python Dependencies

The analytics service is located at:

```text
Final-Backend\backend\analytics\arima_service.py
```

It uses these Python packages:

- `flask`
- `numpy`
- `pandas`
- `statsmodels`
- `scikit-learn`
- `openpyxl`

Recommended setup using a virtual environment:

```powershell
cd "C:\xampp\htdocs\Final-backend(VBETTER)\Final-Backend"
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install flask numpy pandas statsmodels scikit-learn openpyxl
```

If PowerShell blocks virtual environment activation, run:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

Then activate the virtual environment again.

## 6. Run the Python Analytics Service

Start the analytics service in a separate terminal:

```powershell
cd "C:\xampp\htdocs\Final-backend(VBETTER)\Final-Backend"
.\.venv\Scripts\Activate.ps1
python backend\analytics\arima_service.py
```

The service runs on:

```text
http://localhost:5001
```

Test it by opening:

```text
http://localhost:5001/health
```

Expected result: JSON response with `status: "ok"`.

Important: disease analytics and vaccination forecasting need this service running. Apache/PHP alone is not enough for those features.

## 7. Open the Web Application

After Apache, MySQL, and the Python analytics service are running, open:

```text
http://localhost/Final-Backend/public/pages/login.html
```

Useful pages:

```text
Public login:
http://localhost/Final-Backend/public/pages/login.html

Public landing page:
http://localhost/Final-Backend/public/pages/landing.html

Veterinarian dashboard:
http://localhost/Final-Backend/vet/html/index.html

Admin dashboard:
http://localhost/Final-Backend/admin/pages/index.html

Disease analytics:
http://localhost/Final-Backend/vet/html/disease-analytics.html
```

## 8. Basic Run Checklist

Before testing the system, make sure all of these are true:

- `Apache` is running in XAMPP.
- `MySQL` is running in XAMPP.
- Database `bvetter` exists.
- `bvetter.sql` has been imported.
- `backend/config/connection.php` has the correct MySQL username and password.
- Composer dependencies are installed.
- Python dependencies are installed.
- `backend/analytics/arima_service.py` is running on port `5001`.
- The project folder path matches `/Final-Backend`.

## 9. Common Problems and Fixes

### Database connection failed

Check:

- MySQL is running in XAMPP.
- Database name is `bvetter`.
- Username and password in `backend/config/connection.php` are correct.
- If XAMPP MySQL root has no password, use `DB_PASS` as an empty string.

### Page loads but API requests fail

Check that the project folder is located at:

```text
C:\xampp\htdocs\Final-backend(VBETTER)\Final-Backend
```

Some JavaScript files use hardcoded paths. If the folder name is different, API calls may return `404`.

### Disease analytics does not load

Check:

- Python service is running.
- `http://localhost:5001/health` returns JSON.
- `BaliwagVet_2023-2025.xlsx` exists in the project root.
- Required Python packages are installed.

### Composer command not found

Install Composer globally, then reopen the terminal. Or run:

```powershell
php composer.phar install
```

from the `Final-Backend` folder.

### Port 5001 already in use

Another program is using the analytics service port. Stop that program or change the port in:

```text
backend\analytics\arima_service.py
```

Look for:

```python
app.run(host="0.0.0.0", port=5001, debug=False)
```

If you change the port, also update PHP and JavaScript references that call `5001`.

## 10. Development Notes

- Keep `bvetter.sql` updated when database schema changes.
- Do not delete `BaliwagVet_2023-2025.xlsx`; the analytics service reads this file directly.
- Uploaded files are stored under `backend/uploads/`.
- PDF/report generation uses Composer dependencies under `vendor/`.
- Some frontend files use absolute local URLs. Be careful when moving the project to a different folder or deploying to a server.

## 11. Quick Start Summary

```powershell
# 1. Start Apache and MySQL in XAMPP

# 2. Import database
# Import Final-Backend\bvetter.sql into database bvetter using phpMyAdmin

# 3. Install PHP dependencies
cd "C:\xampp\htdocs\Final-backend(VBETTER)\Final-Backend"
composer install

# 4. Install Python dependencies
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install flask numpy pandas statsmodels scikit-learn openpyxl

# 5. Start analytics service
python backend\analytics\arima_service.py

# 6. Open app
# http://localhost/Final-Backend/public/pages/login.html
```
