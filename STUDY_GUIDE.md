# bvetter Study Guide — Defense Prep (through Fri Aug 14, 2026)

Living cheat sheet. Updated each day with corrected gaps, architecture notes, and mock-grill Q&A.

## Environment
- App root: `http://localhost/final-VBETTER/bvetter/`
- DB: MySQL `bvetter`, 37 tables, connects via PDO (`api/config/connection.php`), default root/root
- Stack: vanilla PHP (no framework) + vanilla JS + MySQL. Only Composer dep is `mpdf/mpdf` (PDF generation). Python (`api/analytics/arima_service.py`) handles disease forecasting.
- Three separate frontends sharing one `api/` backend: `public/` (citizen-facing), `admin/`, `vet/`

## Day 1 — Architecture Orientation

**Q: how does data get from the browser into your database?**
My answer: "For example in appointment.js i set or call a fetch appointment.php. This php run, read the data, post the data and talk directly to the database using PDO prepared statement"
→ Correct core idea (JS fetch → PHP reads input → PDO direct to DB, no phpMyAdmin involved). Tighten the wording for defense day: *"The browser sends a POST request via `fetch()` to a PHP file. PHP reads the request body, and talks directly to MySQL through PDO using prepared statements — no intermediary."*

**Request cycle:** browser JS (`addEventListener`) → `fetch()` → PHP file in `api/` → PDO/MySQL → `echo json_encode(...)` → JS reads `r.json()` → DOM update. Each PHP request is stateless — a fresh process per request, no memory between requests except what's in the DB or `$_SESSION`.

**phpMyAdmin is NOT part of the running app.** It's a dev-only GUI for manually poking the DB. The live app talks to MySQL directly via PDO in the PHP files. Never say phpMyAdmin when asked "how does data reach the database."

**Action-dispatch pattern:** Most `api/*/*.php` files are single files handling many operations, chosen by an `action` field in the request body (see `appointment.php:816-841`: one file, ~13 branches — `create`, `list`, `update_status`, `delete`, `reschedule`, `vets`, `booked_slots`, `submit_review`, etc). Two requests hitting the *same URL* can do completely different things depending on `action`.

**No real-time push anywhere.** Admin/vet only see new data when their own page loads/refreshes and fires its own fetch. Confirmed no polling in `vet/` or `admin/` JS (only `setInterval` found is a cosmetic KPI-counter animation in `vet/js/index.js:1386`, not a data refresh).

**Portal/JS-layer map (corrected — not 3 symmetric portals):** `public/` and `admin/` actually **share the same** `public/js/api.js` file (`admin/pages/account-management.html:489` loads `../../public/js/api.js` directly) — admin has no API layer of its own. `vet/` has its own separate `vet-api.js`. All three also pull shared cross-cutting JS from `shared/js/` (`auth.js`, `sidebar.js`). So it's really: 2 API layers (`public/js/api.js` used by 2 portals, `vet/js/vet-api.js` used by 1) + 1 shared layer, not 3 independent stacks.

**`api.js` has stale/aspirational comments.** It documents a JWT `Authorization: Bearer <token>` scheme (`authHeaders()`), but `api.login()` never stores a token anywhere. Real auth mechanism is presumably session/cookie-based — confirm Monday. Lesson: comments describe intent, not necessarily reality — verify against actual behavior.

### ⚠️ Finding (corrected): `api/appointments/appointment.php` — auth is partial, not absent
- First pass (grepping only for `SESSION`) missed that `auth_guard.php` is required *conditionally*, not at the top of the file. Corrected by reading lines 815-826 in full. **Lesson: grep for one term isn't enough — read the surrounding logic before asserting something is "never checked."**
- Real behavior: `$staffActions = ['update_status','delete','add_visit_type','remove_visit_type']` (line 822) — only these call `require_once auth_guard.php; requireRole($pdo, ['veterinarian','admin'])` (line 824-825). `auth_guard.php` itself is solid: bearer token → looked up in `user_sessions` table (`session.php`) → 401/403 on missing/revoked/wrong-role.
- **The gap:** owner-facing actions — `create`, `list`, `reschedule`, `booked_slots`, `submit_review`, `get_total`, `common_cases` — never call `requireRole` (confirmed: grepped every function in the file, only one call site exists, inside the staff-only `if`). They trust `owner_id` straight from the client body.
- A comment at line 819-821 claims *"owner-side identity enforcement is handled separately"* — checked, it is not, anywhere in this file. Second instance today of a comment describing intent/aspiration rather than actual behavior.
- **Accurate defense-ready framing:** "Staff-destructive actions are properly authenticated via a bearer-token session guard. Owner-facing actions, including booking and listing personal appointment data, are not — despite a comment claiming otherwise. The fix is straightforward: the same `requireRole()` pattern already exists and could be extended to those actions." Systemic-vs-isolated across other `api/*.php` files: TBD, check Monday.

## Day 2 — Auth / Session
 so todaym binasa ko ung login php, and acccount management php. After reading okay naman siya i quite understand some part of it. Pero may nakita bug si claude and ayon ung 
    if(!email || password){} 
        which is mali, kasi ang ginagawa ng code nayan or line of code nayan is even tama ung credential, minamali niya.
            for example nag type ako ng right email and right password
                ung email nayon ay magiging false kahit nag lagay ako value kasi may not fucntion while sa password naman ganon rin, altough mag r-run ung system or ung line of code nayan. I bloblock parin tayo kasi ang purpose ng code nayan ay to block someone na hindi equal or tama ugn password. For validation
            kapag naman nag input tayo ng email na tama tas walang password. ganon rin, kaso in this case tama naman ung procedure kasi hindi gagana talaga ung system if wala kang na type na password (false ung password)

    Also upon vieiwng or reading the php file i learn something:
        first is the ? which is the short term for if else statement
            condition ? true: false
        and i learn also the used of isset and $_Post
            isset is a method that check wheather the array or $_Post (a arrray) is null or undefined

    I also change the clinic location to default or read only in the html because this is not private clinic where the vet can have mutlple clinic. In the current sitation of our client, there only one public clininc.

    at first nag tataka ako sa login kasi i cant find a certain line like
        if (email ==user.email && password==hash_password)...
            yun pala, hinawalay sa code para sa security purposes or para hindi makita ung password na hash. So pano  nga ba inisstore ung passsowrd sa database?
                it is stored using hash, after that when we retrieve there a method or funciton that will verifity the password
            so we can say that the code is only one way hash. meaning by only retireving it can get the realpasssowrd or idk?
    and also sa pag block ng account dahil nga naka store to sa database. For example when one user attempt to login mapupunta siya sa DB, after non nag attemp ulit mapupunta sa DB, so meaning walang time expieration ung attemp niya kasi naka store sa DB. So for example next week mag attempt ulit ung user ng mag login. mag block na kasi tatlo na ung nasa DB, ma chchange ung status to blocked and di siya pwede mag login.

    ung session.php naman ang gingagawa niya is kinukha or instore niya ung mga IP address, location and such. so kapag nag ni click ng admin ung end session ma lolog out to. 
    
    ung account management naman nahahti ung ano niya sa CRUD flow. pwede ka mag create, read, update and delete. and search also or filtering. 

    ung secirty setting anman ay ito ung for 2fa, ito ung nad dedefine if ung mga admin or vet ba requires a 2fa
    and lasly ung password policiy is when the admin can modify the password like ilan ung mga character and such. 

    ung auth guard file naman based on the named itself parang ni guard niya if naka login ba ung user,nag extend na sa time limit or what. Coonected siya sa session.php, siguro kasi aparang s asession.php parang gingawa niya or kinukha niya ung mga ip address time and etc. 
        so may 3 block dito, if ung authentication ay okay na, if ung authnetication ay na expired and laslty if ung user ba ay may permissions
        
## Day 3 — Lost & Found (deep-dive CRUD flow)
_(pending)_

## Day 4 — ARIMA Prediction Pipeline
_(pending)_

## Day 5 — Broad Pattern Pass + DB Schema + Mock Defense
_(pending)_

## Glossary
_(terms you got corrected on go here)_

## Mock-Grill Q&A Log
_(interviewer-style questions asked + your refined answers)_
