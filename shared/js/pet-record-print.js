/**
 * pet-record-print.js — a printable summary of one pet's record
 *
 * Used by the owner's My Pets detail and the vet's Patient Records, so an
 * owner can show another clinic their pet's history, and a walk-in owner
 * (who has no login) can be handed one at the counter.
 *
 * It opens the summary in a new window and calls the browser's Print dialog,
 * which also offers "Save as PDF" -- no PDF library needed. It contains only
 * what the owner can already see on screen, and says plainly that it is a
 * system-generated summary, not a certified document: anyone relying on it
 * is told to contact the office to verify.
 *
 * printPetRecord({
 *   recordId, petName, species, breed, sex, age, weight, colorMarkings,
 *   healthStatus, ownerName, ownerPhone,
 *   visits:       [{ date, title, category, symptoms, diagnosis, treatment, medications, attendingVet }],
 *   vaccinations: [{ name, date, nextDue, provider, status }]
 * })
 */

'use strict';

(function () {
    const CLINIC = 'Baliwag City Veterinary Office';
    // Works at the domain root (production) or in a subdirectory (XAMPP).
    const APP_BASE = location.pathname.replace(/\/(public|admin|vet|shared)\/.*$/, '');

    function esc(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function text(value) {
        const v = String(value ?? '').trim();
        return v && v !== 'TBD' ? esc(v) : '—';
    }

    function formatDate(value) {
        const v = String(value ?? '').trim();
        if (!v || v === 'TBD') return '—';
        const date = /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(v + 'T00:00:00') : new Date(v);
        return Number.isNaN(date.getTime())
            ? esc(v)
            : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }

    function medications(list) {
        if (!Array.isArray(list) || !list.length) return '—';
        return list.map(item => esc(typeof item === 'string' ? item : (item && item.name) || '')).filter(Boolean).join(', ') || '—';
    }

    function referenceFor(id) {
        const n = Number(id);
        return Number.isFinite(n) && n > 0 ? 'PR-' + String(n).padStart(4, '0') : '';
    }

    function buildHtml(record) {
        const visits = Array.isArray(record.visits) ? record.visits : [];
        const vaccinations = Array.isArray(record.vaccinations) ? record.vaccinations : [];
        const printed = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        const reference = referenceFor(record.recordId);
        const logo = location.origin + APP_BASE + '/public/images/logos/logo-color.png';

        const profile = [
            ['Species', record.species], ['Breed', record.breed], ['Sex', record.sex],
            ['Age', record.age], ['Weight', record.weight], ['Markings', record.colorMarkings],
            ['Health Status', record.healthStatus],
            ['Owner', record.ownerName], ['Owner Phone', record.ownerPhone],
        ].map(([label, value]) => `<div><span>${label}</span><strong>${text(value)}</strong></div>`).join('');

        const vaccRows = vaccinations.length
            ? vaccinations.map(v => `
                <tr>
                    <td>${text(v.name)}</td>
                    <td>${formatDate(v.date)}</td>
                    <td>${formatDate(v.nextDue)}</td>
                    <td>${text(v.provider)}</td>
                </tr>`).join('')
            : '<tr><td colspan="4" class="empty">No vaccinations recorded.</td></tr>';

        const visitRows = visits.length
            ? visits.map(v => `
                <tr>
                    <td>${formatDate(v.date)}</td>
                    <td><strong>${text(v.title)}</strong>${v.category ? `<br><span class="muted">${esc(v.category)}</span>` : ''}</td>
                    <td>${text(v.symptoms)}</td>
                    <td>${text(v.diagnosis)}</td>
                    <td>${text(v.treatment)}</td>
                    <td>${medications(v.medications)}</td>
                    <td>${text(v.attendingVet)}</td>
                </tr>`).join('')
            : '<tr><td colspan="7" class="empty">No visits recorded.</td></tr>';

        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Pet Record · ${esc(record.petName || 'Pet')}</title>
<style>
    * { box-sizing: border-box; }
    body { font-family: Arial, Helvetica, sans-serif; color: #111827; margin: 0; padding: 28px; font-size: 12px; }
    header { display: flex; align-items: center; gap: 14px; border-bottom: 2px solid #002A58; padding-bottom: 12px; margin-bottom: 18px; }
    header img { height: 44px; }
    header h1 { font-size: 17px; margin: 0; color: #002A58; }
    header p { margin: 2px 0 0; color: #4b5563; }
    h2 { font-size: 20px; margin: 0 0 10px; }
    h3 { font-size: 13px; text-transform: uppercase; letter-spacing: .5px; color: #002A58; margin: 22px 0 8px; }
    .profile { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px 18px; }
    .profile span { display: block; font-size: 10px; text-transform: uppercase; color: #6b7280; }
    .profile strong { font-size: 12.5px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid #d1d5db; padding: 6px 7px; text-align: left; vertical-align: top; }
    th { background: #f3f4f6; font-size: 10.5px; text-transform: uppercase; }
    .muted { color: #6b7280; font-size: 11px; }
    .empty { color: #6b7280; text-align: center; font-style: italic; }
    footer { margin-top: 26px; padding-top: 10px; border-top: 1px solid #d1d5db; color: #4b5563; font-size: 10.5px; line-height: 1.5; }
    .print-bar { margin-bottom: 16px; }
    .print-bar button { font: inherit; padding: 8px 16px; border-radius: 6px; border: 1px solid #002A58; background: #002A58; color: #fff; cursor: pointer; }
    @media print {
        body { padding: 0; }
        .print-bar { display: none; }
        tr { page-break-inside: avoid; }
    }
</style>
</head>
<body>
    <div class="print-bar"><button type="button" id="printAgain">Print / Save as PDF</button></div>
    <header>
        <img src="${esc(logo)}" alt="">
        <div>
            <h1>${CLINIC}</h1>
            <p>Pet Medical Record Summary</p>
        </div>
    </header>

    <h2>${text(record.petName)}</h2>
    <div class="profile">${profile}</div>

    <h3>Vaccination History</h3>
    <table>
        <thead><tr><th>Vaccine</th><th>Date Given</th><th>Next Due</th><th>Given By</th></tr></thead>
        <tbody>${vaccRows}</tbody>
    </table>

    <h3>Visit History</h3>
    <table>
        <thead><tr><th>Date</th><th>Visit</th><th>Symptoms</th><th>Diagnosis</th><th>Treatment</th><th>Medications</th><th>Attending Vet</th></tr></thead>
        <tbody>${visitRows}</tbody>
    </table>

    <footer>
        System-generated from BVetter on ${printed}${reference ? ' · Record #' + reference : ''}.<br>
        For reference only. To verify this record, contact the ${CLINIC}.
    </footer>
</body>
</html>`;
    }

    function printPetRecord(record) {
        const win = window.open('', '_blank');
        if (!win) {
            const message = 'Your browser blocked the print window. Allow pop-ups for this site, then try again.';
            if (typeof vbAlert === 'function') vbAlert(message); else alert(message);
            return;
        }
        win.document.open();
        win.document.write(buildHtml(record || {}));
        win.document.close();

        const print = () => { win.focus(); win.print(); };
        win.document.getElementById('printAgain')?.addEventListener('click', print);
        // Wait for the logo so it makes it onto the page; print anyway if it
        // never arrives.
        const logo = win.document.querySelector('header img');
        if (logo && !logo.complete) {
            logo.addEventListener('load', print, { once: true });
            logo.addEventListener('error', print, { once: true });
        } else {
            setTimeout(print, 50);
        }
    }

    window.printPetRecord = printPetRecord;
})();
