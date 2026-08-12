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
 in php or in SQL the : is used to bind varibale. Meaning it can be reused many times which help for security 
 while the ?? is used to set the default of value of something if true to that value for example value_1 ??: default value if the value is not the value_1 it will go with default value. 
    while the?: have simmilar functionality.
        $value ?: "Default";
            if the value is truth not null or empty, it will go to value otherwise it will go to default value
 this line in the php appointment notifcation
        $recipientEmail = $row['contact_email'] ?: $row['owner_email'];
    so we get the value of the form by getting or using the fetch and stored it in var row, so the line above say if there not contanct email, we will notfity the owner email. Because in the appointment we asked the user to input a email so that they can be notify in their appointment. This is deffirent between the owner email, Owner email is the one the pet owner used. 

    the appointment notifcation basically, the backend for sending notifcation to user when they booked, this notifcation is sent thru email and the website app. 

    $_Server = is a command to get the header of the file, or webrowser 
    why does the creation of account is alsoo in appointment?

    new  finding, we can store pala ung where statement in a list
    .implode is like join, which pinag sa-sama natin ung mga elements sa array

    jaccard similarity -> in lost and found the function of this is to compare the color, marking in each report of found and lost. tas titingan niya if may similar word ba sa both word for example sa found report merong kulay pink, tas sa lost naman may sentence na mendyo pink, tas kulay white collar. Kapag mas marami ung similar word mas maraming score, mas mababa less similar or same character.

    color blob -> ito naman ung two method  rgbSimilarity() + average_rgb(). Ang gingawa lang nito is sa isang picture, parang pinag sasasama niya ung average color. For example sa picture na ang focus ay ung pet na color brown. icocompress niya yon then parang kukunin ung average. after makuha ung average doon parang sasabihin na ang color or the average color of this color are red,blue or what. So ginagamit to to report and found report, kasi may mga picture so ni cocompare ung average color per picture again if mas mataas ung confidence level ibigisanhin parang same color sila. 

    checkerboard -> shrink the image 12x12 grid, na parang chessboard or checkboard, tas each box or square parang ung system mag add if light ba or dark, if anong color ung box nayon and such. so gingamit nga rin to kasi may two images tayo, this two images is nahahti sa 12x12 grid tas parang each photo is may mga square na ang iidnefity na kung ano type to or what. And then sassabihin ng system if match ba sila or not, In another word parang isnabi if may similar ba ung mga box. For example sa isang box kulay brown, tas sa isang naman medyo light brown, may similar pero may nag iba. ito ung hamming similarity. ->  this is brightness_hash() in image_matcher.py, and hammingSimilarity()


    creating report - the backend first verifity if the user is exisiting based on this line "if ($ownerId <= 0) " 
        after that the we have a method or function taht is for normalize, cleaning, and check if wheter the field have a value. 
        after confirming the validation like character limit and such we insert it in database.
        after sending to the database, the notifciation will be proceed
    the limit of picture or file is 8mb with the system allowing 4 types of file jpeg, png, webp, and pdf.And also uses a method called finfo which check the file bytes and detect real mime type because sometime, or for example when user rename the file virus.exe, to image.png, without checking the byte of file, the system will bypass this. Which can mean lack of security.
    also the image stored or upload by petowner or users, are renamed by timestamp +12 random hex character, because sometime or some scneario where differnt user upload the same file, after they upload this same file. It can cause error in the database and the server,
    after this, the system store this picture temporarly and after it point to move_uploaded_file($file['tmp_name'], $absolute) it will be move out to the real storage
## Day 4 — ARIMA Prediction Pipeline
 architecture of the arima services
    browser -> php, sent a fetch to -> flash to run the python file. 

to check if the services are running, we first read the output of the test evaluate
    - in the first figure, risk class distribution we notice there low value of low, that why the test of it are kinda low also. Which make it the distribution of data kinda low.
    - confusion matrix also show that the low have only low dataasets. but the high and medium are kinda okay and functioning, But when the system encounter a low it may not function well
    -the per class metrics show, the accuracy level of precision, recall, and f1 score. The precision score both 0.98, and the recall is 1, and laslty the f1 scoree with the score of 0.99. Ihave doubt in this, because the value are very high or accurate.
    - in the figure 4, i have hard time understanding it. 
    -the figure 5 is the mean decrease in impurity. This state that the higher the input the most usufull but across the selection the only usefull are lag_1
    -the figure 6 are hard to understand
    -the figure 7 is the arima forecast, where we forecast the mange in poblacion year. And based on the output it seem working, but the prediction might not accurate. or not confident. maybe its due to the missing data across the year
    -the figure7b is the same, but in the mass vaccination term. the accuration of prediciton is kinda off
    the figure 8 is just showing the MAE RMSE AND MAPE, which are totally working fine kaso parang off ung MAPE
    -the figure 9 is kinda hard to understand.
    
    - in the first phase of the devolopment of the vbetter, may ML tayong gingamit pero nag fail to, kasi sa isang barangay tiaong may 21-30 cases siya a mmonth, but it always show high. kaya ni thow nalnag ung ML nato tas ang pinalit ay mas simple if mas mababa sa 50th percentile its low kapag 50-75 its meduim and kapag 75 and up ayon ung high 

    method fallback forecast
        there are two variable that stick out the slope and fc
            slope is actual logic condition, while the fc is defensive check it will return an array or list contain that value
    in method run_arima
        i think its the fc variable
            it will build a list to set up actual design logic
    methods functions  and what they do
        adf_test_report = this method will be used in augmented dickey fuller stationary parang ginagamit to see if the data are actualling moving or if the data is ginagamit throughout the system or the analysis.
            the "_" is used, normal variable. parang sinasabi na gusto ko kunin ung value pero parang di ko naman kailgan
            adfuller() -> is the augmented filler test  it does this series have stable mean over time or does drift.trend.
        select_arima_order():  dito parang nag se-select pdq where ito ung 5AIC, 
        RMSE() AND MAPE - RMSE STAND FOR ROOT MEAN SQUARED ERROR, AND MEAN ABSOLUTE PERCENTAGE ERROR
        _FORECAST_IS_RUNWAY = PARANG ITO UNG NI SANITY CHECK ( KUNG TAMA UNG CALCUATION) UNG MGA DATA
        
## Day 5 — Broad Pattern Pass + DB Schema + Mock Defense
_(pending)_

## Glossary
_(terms you got corrected on go here)_

## Mock-Grill Q&A Log
_(interviewer-style questions asked + your refined answers)_
