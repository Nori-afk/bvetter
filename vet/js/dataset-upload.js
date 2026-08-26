/* BVetter — Dataset Upload.
 *
 * Talks to api/dataset/dataset.php. The bearer token is attached by the global
 * fetch wrapper in shared/js/auth.js, so no Authorization header is set here.
 *
 * Deliberately shows what an upload DID rather than just "success": how many
 * rows the file held, how many were carried forward from the previous version,
 * how many were genuinely new, and the coverage span that resulted. A merge
 * that silently no-ops looks identical to one that worked unless those numbers
 * are on screen.
 */

const DATASET_API = '/api/dataset/dataset.php';

const el = (id) => document.getElementById(id);

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

function formatDate(value) {
    if (!value) return '—';
    const d = new Date(String(value).replace(' ', 'T'));
    if (isNaN(d)) return String(value);
    return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

function formatSpan(from, through) {
    if (!from || !through) return '—';
    const a = new Date(from), b = new Date(through);
    if (isNaN(a) || isNaN(b)) return `${from} – ${through}`;
    return `${MONTHS[a.getMonth()].slice(0, 3)} ${a.getFullYear()} – ${MONTHS[b.getMonth()].slice(0, 3)} ${b.getFullYear()}`;
}

const num = (n) => Number(n || 0).toLocaleString();

function message(kind, html) {
    const box = el('du-message');
    box.className = `du-msg du-msg-${kind}`;
    box.innerHTML = html;
    box.hidden = false;
    box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function clearMessage() {
    const box = el('du-message');
    box.hidden = true;
    box.innerHTML = '';
}

async function datasetRequest(action, formData) {
    const body = formData || new FormData();
    body.set('action', action);
    const response = await fetch(DATASET_API, { method: 'POST', body });
    let result;
    try {
        result = await response.json();
    } catch {
        throw new Error('The server returned an unexpected response.');
    }
    if (!response.ok || !result.success) {
        throw new Error(result.message || 'Dataset request failed.');
    }
    return result;
}

/* ── Rendering ──────────────────────────────────────────────────── */

function renderActive(versions) {
    const active = versions.find((v) => Number(v.is_active) === 1);
    const host = el('du-active');

    if (!active) {
        host.innerHTML = `
            <div class="du-active-empty">
                No dataset has been uploaded yet. The system is reading the bundled
                workbook (<code>BaliwagVet_2023-2025.xlsx</code>) as a fallback.
                Uploading a file here replaces it as the source for the charts,
                reports and forecasts.
            </div>`;
        return;
    }

    host.innerHTML = `
        <div class="du-stat-row">
            <div class="du-stat">
                <span class="du-stat-label">Consultations in use</span>
                <span class="du-stat-value">${num(active.row_count)}</span>
                <span class="du-stat-note">version ${active.id}</span>
            </div>
            <div class="du-stat">
                <span class="du-stat-label">Period covered</span>
                <span class="du-stat-value" style="font-size:15px">${formatSpan(active.covers_from_date, active.covers_through_date)}</span>
                <span class="du-stat-note">${active.covers_from_date || '—'} to ${active.covers_through_date || '—'}</span>
            </div>
            <div class="du-stat">
                <span class="du-stat-label">Uploaded</span>
                <span class="du-stat-value" style="font-size:15px">${formatDate(active.uploaded_at)}</span>
                <span class="du-stat-note">${active.uploaded_by ? vbEscapeHtml(active.uploaded_by) : 'unknown'}</span>
            </div>
            <div class="du-stat">
                <span class="du-stat-label">Source file</span>
                <span class="du-stat-value" style="font-size:13px;word-break:break-all">${vbEscapeHtml(active.filename || '—')}</span>
                ${active.note ? `<span class="du-stat-note">${vbEscapeHtml(active.note)}</span>` : ''}
            </div>
        </div>`;
}

function renderVersions(versions) {
    const host = el('du-versions');
    if (!versions.length) {
        host.innerHTML = '<div class="du-active-empty">No uploads recorded yet.</div>';
        return;
    }

    const rows = versions.map((v) => {
        const isActive = Number(v.is_active) === 1;
        return `
            <tr class="${isActive ? 'is-active' : ''}">
                <td>${v.id}</td>
                <td>
                    <span class="du-file-name">${vbEscapeHtml(v.filename || '—')}</span>
                    ${v.note ? `<div class="du-dim">${vbEscapeHtml(v.note)}</div>` : ''}
                </td>
                <td>${num(v.row_count)}</td>
                <td class="du-dim">${formatSpan(v.covers_from_date, v.covers_through_date)}</td>
                <td class="du-dim">${formatDate(v.uploaded_at)}<br>${vbEscapeHtml(v.uploaded_by || '')}</td>
                <td>${isActive
                    ? '<span class="du-pill">In use</span>'
                    : `<button type="button" class="du-btn du-btn-ghost" data-activate="${v.id}">Switch back to this</button>`}
                </td>
            </tr>`;
    }).join('');

    host.innerHTML = `
        <div class="du-table-wrap">
            <table class="du-table">
                <thead>
                    <tr><th>#</th><th>File</th><th>Rows</th><th>Covers</th><th>Uploaded</th><th></th></tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        </div>`;

    host.querySelectorAll('[data-activate]').forEach((button) => {
        button.addEventListener('click', () => activateVersion(button.dataset.activate, button));
    });
}

async function loadVersions() {
    try {
        const result = await datasetRequest('versions');
        const versions = result.data || [];
        renderActive(versions);
        renderVersions(versions);
    } catch (error) {
        message('error', `Could not load dataset versions. ${vbEscapeHtml(error.message)}`);
    }
}

/* ── Actions ────────────────────────────────────────────────────── */

async function activateVersion(versionId, button) {
    // Switching the active version changes every chart, report and forecast in
    // the portal, so it asks first.
    if (!window.confirm(
        `Switch the system back to dataset version ${versionId}?\n\n` +
        'Every chart, report and forecast will use that version from now on. ' +
        'Nothing is deleted, and you can switch again at any time.')) {
        return;
    }
    button.disabled = true;
    button.textContent = 'Switching…';
    try {
        const body = new FormData();
        body.set('versionId', versionId);
        const result = await datasetRequest('activate', body);
        message('ok', `<strong>Done.</strong> ${vbEscapeHtml(result.message)}`);
        await loadVersions();
    } catch (error) {
        message('error', `Could not switch version. ${vbEscapeHtml(error.message)}`);
        button.disabled = false;
        button.textContent = 'Switch back to this';
    }
}

function describeResult(data) {
    const carried = Number(data.rowsCarried || 0);
    const added = Number(data.rowsAdded || 0);
    const inFile = Number(data.rowsInFile || 0);

    let merge;
    if (carried === 0) {
        merge = `This is the first dataset, so all ${num(inFile)} consultations from the file were loaded.`;
    } else if (added === 0) {
        merge = `All ${num(inFile)} consultations in the file were already on record, so nothing was double-counted. ` +
                `Any changed details were updated in place.`;
    } else {
        merge = `${num(carried)} existing consultations were carried forward and ${num(added)} new ones were added ` +
                `from the ${num(inFile)} in the file.`;
    }

    return `
        <strong>Upload complete.</strong> ${vbEscapeHtml(merge)}
        <ul>
            <li><strong>${num(data.rowsTotal)}</strong> consultations now in use (version ${data.versionId})</li>
            <li>Covering <strong>${vbEscapeHtml(formatSpan(data.coversFrom, data.coversThrough))}</strong></li>
            <li>Forecasts and charts ${data.analyticsNotified
                ? 'have been refreshed'
                : 'will refresh on their next load'}</li>
        </ul>`;
}

async function submitUpload(event) {
    event.preventDefault();
    clearMessage();

    const input = el('du-file');
    const file = input.files && input.files[0];
    if (!file) {
        message('warn', 'Choose an .xlsx file to upload first.');
        return;
    }

    const button = el('du-submit');
    button.disabled = true;
    button.innerHTML = '<span class="du-spinner"></span>Uploading…';

    try {
        const body = new FormData();
        body.set('file', file);
        body.set('note', el('du-note').value || '');
        const result = await datasetRequest('upload', body);
        message('ok', describeResult(result.data || {}));
        el('du-form').reset();
        el('du-dz-file').textContent = '';
        await loadVersions();
    } catch (error) {
        // The server's validation messages are written for the encoder
        // ("14 rows have a blank consultation_id"), so they are shown as-is
        // rather than replaced with a generic failure.
        message('error', `<strong>Upload rejected.</strong> ${vbEscapeHtml(error.message)}`);
    } finally {
        button.disabled = false;
        button.textContent = 'Upload dataset';
    }
}

/* ── Wiring ─────────────────────────────────────────────────────── */

function showChosenFile(file) {
    el('du-dz-file').textContent = file ? `Selected: ${file.name}` : '';
}

document.addEventListener('DOMContentLoaded', () => {
    el('du-form').addEventListener('submit', submitUpload);

    const zone = el('du-dropzone');
    const input = el('du-file');

    zone.addEventListener('click', () => input.click());
    input.addEventListener('change', () => showChosenFile(input.files[0]));

    ['dragenter', 'dragover'].forEach((type) => {
        zone.addEventListener(type, (e) => { e.preventDefault(); zone.classList.add('is-over'); });
    });
    ['dragleave', 'drop'].forEach((type) => {
        zone.addEventListener(type, (e) => { e.preventDefault(); zone.classList.remove('is-over'); });
    });
    zone.addEventListener('drop', (e) => {
        const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (!file) return;
        // DataTransfer -> input.files so the form submits it like a picked file.
        const transfer = new DataTransfer();
        transfer.items.add(file);
        input.files = transfer.files;
        showChosenFile(file);
    });

    loadVersions();
});
