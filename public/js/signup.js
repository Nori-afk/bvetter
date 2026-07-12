/* =============================================
   BVETTER — Create Account JS
   File: js/signup.js
============================================= */

let currentStep = 1;

const otpState = {
    email: { verified: false, timer: null, verifiedValue: '' },
};

const VERIFY_API = 'http://localhost/final-VBETTER/bvetter/api/admin/verify-contact.php';

/* ══════════════════════════════════════════════
   PROOF UPLOAD PREVIEW
══════════════════════════════════════════════ */

const FILE_ICON_SVG = `
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M6 2H14L20 8V20C20 21.1 19.1 22 18 22H6C4.9 22 4 21.1 4 20V4C4 2.9 4.9 2 6 2Z" stroke="#00963a" stroke-width="1.6" stroke-linejoin="round"/>
      <path d="M14 2V8H20" stroke="#00963a" stroke-width="1.6" stroke-linejoin="round"/>
    </svg>
`;

function formatFileSize(bytes) {
    return bytes > 1024 * 1024
        ? (bytes / (1024 * 1024)).toFixed(2) + ' MB'
        : Math.ceil(bytes / 1024) + ' KB';
}

function updateProofPreview(file) {
    const box      = document.getElementById('proof_upload_box');
    const empty    = document.getElementById('proof_upload_empty');
    const preview  = document.getElementById('proof_upload_preview');
    const thumb    = document.getElementById('proof_preview_thumb');
    const nameEl   = document.getElementById('proof_preview_name');
    const sizeEl   = document.getElementById('proof_preview_size');
    if (!box || !empty || !preview || !thumb || !nameEl || !sizeEl) return;

    if (!file) {
        box.classList.remove('has-file');
        empty.hidden   = false;
        preview.hidden = true;
        thumb.innerHTML = '';
        nameEl.textContent = '';
        sizeEl.textContent = '';
        return;
    }

    box.classList.add('has-file');
    empty.hidden   = true;
    preview.hidden = false;
    nameEl.textContent = file.name;
    sizeEl.textContent = formatFileSize(file.size);

    if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = (e) => {
            thumb.innerHTML = `<img src="${e.target.result}" alt="Preview"/>`;
        };
        reader.readAsDataURL(file);
    } else {
        thumb.innerHTML = FILE_ICON_SVG;
    }
}

document.getElementById('reg_proof')?.addEventListener('change', function () {
    updateProofPreview(this.files[0] || null);
});

document.getElementById('proof_remove_btn')?.addEventListener('click', function (event) {
    event.stopPropagation();
    const input = document.getElementById('reg_proof');
    if (input) input.value = '';
    updateProofPreview(null);
});

/* If the user edits the email after verifying it, the verification no longer
   applies — clear it immediately so the UI never shows a stale "verified"
   state for an address that hasn't actually been confirmed. */
document.getElementById('reg_email')?.addEventListener('input', function () {
    if (otpState.email.verified && otpState.email.verifiedValue !== this.value.trim()) {
        resetEmailVerification();
    }
});

/* ══════════════════════════════════════════════
   STEP NAVIGATION
══════════════════════════════════════════════ */

function goTo(step) {
    if (currentStep === 1 && step === 2) {
        if (!validateStep1()) return;

        const currentEmail = document.getElementById('reg_email')?.value.trim();
        // Verification is tied to the exact email that was OTP-confirmed. If the
        // user goes back and edits the email after verifying, the old "verified"
        // flag no longer applies to this (different) address — require OTP again.
        if (!otpState.email.verified || otpState.email.verifiedValue !== currentEmail) {
            resetEmailVerification();
            startOtpFlow();
            return;
        }
    }

    if (currentStep === 2 && step === 3) {
        if (!validateStep2()) return;
    }

    document.getElementById('step-' + currentStep).classList.remove('active');
    currentStep = step;
    document.getElementById('step-' + currentStep).classList.add('active');

    if (step === 3) reviewStep();
    updateStepper(step);
}

/* ── Reset OTP verification state (email changed since last verify) ── */
function resetEmailVerification() {
    otpState.email.verified = false;
    otpState.email.verifiedValue = '';
    document.getElementById('email-verified-badge')?.setAttribute('hidden', '');
}

/* ── Validate Step 2 (proof of residency) before advancing to review ── */
function validateStep2() {
    const proofInput = document.getElementById('reg_proof');
    if (!proofInput?.files.length) {
        showStepError('Please upload your proof of residency.', 2);
        return false;
    }
    clearStepError(2);
    return true;
}

/* ── PH mobile number check: 09XXXXXXXXX / +639XXXXXXXXX / 639XXXXXXXXX ── */
function isValidPHPhone(value) {
    const cleaned = value.trim().replace(/[\s-]/g, '');
    return /^(?:\+63|63|0)9\d{9}$/.test(cleaned);
}

/* ── Validate Step 1 fields before OTP ── */
function validateStep1() {
    const fullname = document.getElementById('reg_fullname')?.value.trim();
    const email    = document.getElementById('reg_email')?.value.trim();
    const pw1      = document.getElementById('reg_pw1')?.value;
    const pw2      = document.getElementById('reg_pw2')?.value;
    const phone    = document.getElementById('rv_phone')?.value.trim();
    const barangay = document.getElementById('reg_barangay')?.value;
    const terms    = document.getElementById('reg_terms')?.checked;

    if (!fullname) { showStepError('Please enter your full name.'); return false; }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        showStepError('Please enter a valid email address.'); return false;
    }
    if (!pw1 || pw1.length < 8) {
        showStepError('Password must be at least 8 characters.'); return false;
    }
    if (pw1 !== pw2) { showStepError('Passwords do not match.'); return false; }
    if (!phone) { showStepError('Please enter your phone number.'); return false; }
    if (!isValidPHPhone(phone)) {
        showStepError('Please enter a valid Philippine mobile number (e.g. 09171234567).');
        return false;
    }
    if (!barangay) { showStepError('Please select your barangay.'); return false; }
    if (!terms) { showStepError('Please agree to the Terms of Service.'); return false; }

    clearStepError();
    return true;
}

/* ══════════════════════════════════════════════
   OTP FLOW CONTROLLER
══════════════════════════════════════════════ */

function startOtpFlow() {
    openOtpModal('email');
}

/* ══════════════════════════════════════════════
   OTP MODAL — open, send, verify, resend
══════════════════════════════════════════════ */

function openOtpModal(type) {
    const value = document.getElementById('reg_email')?.value.trim();

    document.getElementById(`otp-${type}-display`).textContent = value;

    clearOtpInputs(type);
    hideOtpError(type);

    document.getElementById(`modal-otp-${type}`).hidden = false;

    sendOtp(type, value);

    setTimeout(() => {
        document.querySelector(`#otp-${type}-inputs .otp-digit`)?.focus();
    }, 80);
}

async function sendOtp(type, value) {
    try {
        const body = new FormData();
        body.append('action', 'send_email_otp');
        body.append('email', value);

        const res  = await fetch(VERIFY_API, { method: 'POST', body });
        const text = await res.text();

        let data;
        try {
            data = JSON.parse(text);
        } catch {
            console.error('Non-JSON response:', text);
            showOtpError(type, 'Server error. Please try again.');
            return;
        }

        if (!data.success) {
            showOtpError(type, data.message || 'Failed to send code.');
            return;
        }

        startCountdown(type, 600);

    } catch (err) {
        console.error('sendOtp error:', err);
        showOtpError(type, 'Network error. Please try again.');
    }
}

async function verifyOtp(type) {
    const digits = [...document.querySelectorAll(`#otp-${type}-inputs .otp-digit`)];
    const code   = digits.map(d => d.value).join('');

    if (code.length < 6) {
        shakeDigits(digits);
        showOtpError(type, 'Please enter all 6 digits.');
        return;
    }

    hideOtpError(type);

    const value = document.getElementById(`otp-${type}-display`).textContent;

    try {
        const body = new FormData();
        body.append('action', 'verify_otp');
        body.append('type',   type);
        body.append('value',  value);
        body.append('code',   code);

        const res  = await fetch(VERIFY_API, { method: 'POST', body });
        const text = await res.text();

        let data;
        try {
            data = JSON.parse(text);
        } catch {
            console.error('Non-JSON response:', text);
            showOtpError(type, 'Server error. Please try again.');
            return;
        }

        if (!data.success) {
            shakeDigits(digits);
            showOtpError(type, data.message || 'Incorrect code.');
            return;
        }

        // Mark verified — record the exact value that was confirmed, so a later
        // edit to this field can be detected and re-verification required.
        otpState[type].verified = true;
        otpState[type].verifiedValue = value;
        clearInterval(otpState[type].timer);

        // Close modal
        document.getElementById(`modal-otp-${type}`).hidden = true;

        // Show badge
        markVerifiedBadge(type);

        // Go straight to step 2
        document.getElementById('step-' + currentStep).classList.remove('active');
        currentStep = 2;
        document.getElementById('step-' + currentStep).classList.add('active');
        updateStepper(2);

    } catch (err) {
        console.error('verifyOtp error:', err);
        showOtpError(type, 'Network error. Please try again.');
    }
}

/* ══════════════════════════════════════════════
   COUNTDOWN TIMER
══════════════════════════════════════════════ */

function startCountdown(type, seconds) {
    const el = document.getElementById(`otp-${type}-timer`);
    if (!el) return;

    clearInterval(otpState[type].timer);
    let remaining = seconds;

    const tick = () => {
        const m = String(Math.floor(remaining / 60)).padStart(2, '0');
        const s = String(remaining % 60).padStart(2, '0');
        el.textContent = `${m}:${s}`;
        el.style.color = remaining <= 60 ? '#e53e3e' : '#00B928';

        if (remaining === 0) {
            clearInterval(otpState[type].timer);
            showOtpError(type, 'Code expired. Please request a new one.');
        } else {
            remaining--;
        }
    };

    tick();
    otpState[type].timer = setInterval(tick, 1000);
}

/* ══════════════════════════════════════════════
   WIRE OTP MODALS ON DOM READY
══════════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', () => {
    // Only wire email — phone OTP removed
    ['email'].forEach(type => {
        const container = document.getElementById(`otp-${type}-inputs`);
        if (container) {
            const digits = [...container.querySelectorAll('.otp-digit')];

            digits.forEach((input, idx) => {
                input.addEventListener('input', () => {
                    input.value = input.value.replace(/\D/, '').slice(-1);
                    input.classList.toggle('filled', input.value !== '');
                    if (input.value && idx < digits.length - 1) digits[idx + 1].focus();
                });

                input.addEventListener('keydown', e => {
                    if (e.key === 'Backspace' && !input.value && idx > 0) {
                        digits[idx - 1].value = '';
                        digits[idx - 1].classList.remove('filled');
                        digits[idx - 1].focus();
                    }
                });

                input.addEventListener('paste', e => {
                    e.preventDefault();
                    const text = (e.clipboardData || window.clipboardData)
                        .getData('text').replace(/\D/g, '');
                    [...text.slice(0, 6)].forEach((ch, i) => {
                        if (digits[i]) {
                            digits[i].value = ch;
                            digits[i].classList.add('filled');
                        }
                    });
                    const next = digits.findIndex(d => !d.value);
                    (digits[next] || digits[digits.length - 1]).focus();
                });
            });
        }

        document.getElementById(`otp-${type}-verify-btn`)
            ?.addEventListener('click', () => verifyOtp(type));

        const resendBtn = document.getElementById(`otp-${type}-resend-btn`);
        if (resendBtn) {
            resendBtn.addEventListener('click', async () => {
                const value = document.getElementById(`otp-${type}-display`).textContent;
                resendBtn.disabled = true;
                clearOtpInputs(type);
                hideOtpError(type);
                await sendOtp(type, value);

                let cd = 30;
                const orig = 'Resend Code';
                const cdInt = setInterval(() => {
                    resendBtn.textContent = `Resend (${cd}s)`;
                    if (--cd < 0) {
                        clearInterval(cdInt);
                        resendBtn.disabled = false;
                        resendBtn.textContent = orig;
                    }
                }, 1000);
            });
        }

        document.getElementById(`otp-${type}-close-btn`)
            ?.addEventListener('click', () => {
                document.getElementById(`modal-otp-${type}`).hidden = true;
                clearInterval(otpState[type].timer);
            });
    });

    loadBarangays();
    updateStepper(1);

    const terms = document.getElementById('reg_terms');
    if (terms) terms.checked = false;

    // Reset verified state and badges on load
    resetEmailVerification();
});

/* ══════════════════════════════════════════════
   STEPPER
══════════════════════════════════════════════ */

function updateStepper(step) {
    for (let i = 1; i <= 3; i++) {
        const circle = document.getElementById('circle-' + i);
        if (!circle) continue;
        circle.classList.remove('active', 'done');

        if (i < step) {
            circle.classList.add('done');
            circle.innerHTML = '&#10003;';
        } else if (i === step) {
            circle.classList.add('active');
            circle.textContent = i;
        } else {
            circle.textContent = i;
        }

        if (i < 3) {
            const line = document.getElementById('line-' + i);
            if (line) line.classList.toggle('active', i < step);
        }
    }
}

/* ══════════════════════════════════════════════
   REVIEW STEP
══════════════════════════════════════════════ */

function reviewStep() {
    const fullname  = document.getElementById('reg_fullname')?.value || '';
    const email     = document.getElementById('reg_email')?.value || '';
    const pw1       = document.getElementById('reg_pw1')?.value || '';
    const pw2       = document.getElementById('reg_pw2')?.value || '';
    const phone     = document.getElementById('rv_phone')?.value || '';
    const barangay  = document.getElementById('reg_barangay');
    const proofFile = document.getElementById('reg_proof');

    document.getElementById('rv_fullname').value = fullname;
    document.getElementById('rv_email').value    = email;
    document.getElementById('rv_pw').value       = pw1;
    document.getElementById('rv_pw2').value      = pw2;
    document.getElementById('phone').value       = phone;

    if (barangay) {
        document.getElementById('rv_barangay').value =
            barangay.options[barangay.selectedIndex]?.text || '';
        document.getElementById('rv_barangay_id').value = barangay.value || '';
    }

    const file = proofFile && proofFile.files.length > 0 ? proofFile.files[0] : null;
    document.getElementById('rv_proof_name').textContent = file ? file.name : 'No file selected';

    renderProofPreview(file, {
        wrap: 'rv_preview_wrap',
        img: 'rv_preview_img',
        pdf: 'rv_preview_pdf'
    });
}

/* ══════════════════════════════════════════════
   REGISTRATION SUBMIT
══════════════════════════════════════════════ */

async function submitRegistration() {
    const proofInput      = document.getElementById('reg_proof');
    const fullname        = document.getElementById('rv_fullname')?.value.trim() || '';
    const email           = document.getElementById('rv_email')?.value.trim() || '';
    const password        = document.getElementById('rv_pw')?.value || '';
    const confirmPassword = document.getElementById('rv_pw2')?.value || '';
    const phone           = document.getElementById('phone')?.value.trim() || '';
    const barangayId      = document.getElementById('rv_barangay_id')?.value || '';

    // Final safety net: re-check everything right before submit, in case the
    // user navigated back and forth between steps and something drifted out
    // of sync (e.g. email changed after verification, a field left empty).
    if (!fullname) {
        alert('Please enter your full name.');
        return;
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        alert('Please enter a valid email address.');
        return;
    }
    if (!otpState.email.verified || otpState.email.verifiedValue !== email) {
        alert('This email address has not been verified. Please go back and verify it.');
        goTo(1);
        return;
    }
    if (password.length < 8) {
        alert('Password must be at least 8 characters.');
        return;
    }
    if (password !== confirmPassword) {
        alert('Passwords do not match.');
        return;
    }
    if (!phone || !isValidPHPhone(phone)) {
        alert('Please enter a valid Philippine mobile number.');
        return;
    }
    if (!barangayId) {
        alert('Please select your barangay.');
        return;
    }
    if (!proofInput?.files.length) {
        alert('Please upload your proof of residence.');
        return;
    }

    const formData = new FormData();
    formData.append('full_name',      document.getElementById('rv_fullname')?.value || '');
    formData.append('email',          document.getElementById('rv_email')?.value || '');
    formData.append('password',       password);
    formData.append('phone_number',   document.getElementById('phone')?.value || '');
    formData.append('barangay_id',    document.getElementById('rv_barangay_id')?.value || '');
    formData.append('proof_document', proofInput.files[0]);

    try {
        const result = await api.register(formData);

        if (!result.success) {
            alert(result.message || 'Registration failed.');
            return;
        }

        const refEl = document.getElementById('reg_ref_number');
        if (refEl && result.reference_number) {
            refEl.textContent = result.reference_number;
        }

        goTo(4);
    } catch {
        alert('Registration failed. Please try again.');
    }
}

/* ══════════════════════════════════════════════
   UTILITIES
══════════════════════════════════════════════ */

function togglePw(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.type = el.type === 'password' ? 'text' : 'password';
}

function copyRef() {
    const ref = document.getElementById('reg_ref_number')?.textContent || '';
    navigator.clipboard.writeText(ref).catch(() => {});
}

async function loadBarangays() {
    const select = document.getElementById('reg_barangay');
    if (!select) return;

    try {
        const result = await api.getBarangays();
        if (!result.success) { alert(result.message || 'Failed to load barangays.'); return; }

        select.innerHTML = '<option value="">Select Barangay</option>';
        result.data.forEach(b => {
            const opt = document.createElement('option');
            opt.value = b.id;
            opt.textContent = b.name;
            select.appendChild(opt);
        });
    } catch {
        alert('Could not load barangays.');
    }
}

/* ── OTP UI helpers ── */

function clearOtpInputs(type) {
    document.querySelectorAll(`#otp-${type}-inputs .otp-digit`).forEach(d => {
        d.value = '';
        d.classList.remove('filled', 'error');
    });
}

function shakeDigits(digits) {
    digits.forEach(d => {
        d.classList.add('error');
        setTimeout(() => d.classList.remove('error'), 600);
    });
}

function showOtpError(type, msg) {
    const el = document.getElementById(`otp-${type}-error`);
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
}

function hideOtpError(type) {
    const el = document.getElementById(`otp-${type}-error`);
    if (el) el.hidden = true;
}

function markVerifiedBadge(type) {
    const badgeId = type === 'email' ? 'email-verified-badge' : 'phone-verified-badge';
    const badge   = document.getElementById(badgeId);
    if (badge) badge.removeAttribute('hidden');
}

function showStepError(msg, step = 1) {
    clearStepError(step);
    const btn = document.querySelector('#step-' + step + ' .btn-primary');
    if (!btn) return;
    const el = document.createElement('p');
    el.id        = 'step' + step + '-error';
    el.className = 'step-error-msg';
    el.textContent = msg;
    btn.before(el);
}

function clearStepError(step = 1) {
    document.getElementById('step' + step + '-error')?.remove();
}