/**
 * forgot-password.js
 * Page: public/forgot-password.html
 */

document.addEventListener('DOMContentLoaded', () => {
    const emailInput = document.getElementById('resetEmail');
    const sendBtn    = document.querySelector('.btn-send');

    if (!sendBtn || !emailInput) return;

    sendBtn.addEventListener('click', handleForgotPassword);
    emailInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') handleForgotPassword();
    });
});

async function handleForgotPassword() {
    const emailInput = document.getElementById('resetEmail');
    const sendBtn    = document.querySelector('.btn-send');
    const email      = emailInput.value.trim();

    clearError();

    if (!email) {
        showError('Please enter your email address.');
        emailInput.focus();
        return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        showError('Please enter a valid email address.');
        emailInput.focus();
        return;
    }

    sendBtn.disabled    = true;
    sendBtn.textContent = 'Sending…';

    try {
        const result = await api.forgotPassword(email);

        // DEV MODE: show the reset link directly on the page
        if (result.dev_link) {
            console.info('%c[Dev] Reset link: ' + result.dev_link, 'color:#00B928;font-weight:bold');
            showDevLink(result.dev_link);
        }

        if (!result.success) {
            showError(result.message || 'Something went wrong. Please try again.');
            return;
        }

        showSuccess(email);

    } catch (err) {
        console.error('forgotPassword error:', err);
        showError('Server error — check the browser console for details.');
    } finally {
        sendBtn.disabled    = false;
        sendBtn.textContent = 'Send Reset Link';
    }
}

/* ── UI helpers ── */

function showSuccess(email) {
    const card = document.querySelector('.card');
    if (!card) return;

    card.innerHTML = `
        <img src="../images/icons/icon-reset.svg" alt="" class="card-icon"/>
        <h2>Check Your Email</h2>
        <p class="card-subtitle">
            We sent a password reset link to<br>
            <strong>${escapeHtml(email)}</strong><br><br>
            The link expires in <strong>1 hour</strong>.
            Check your spam folder if you don't see it.
        </p>
        <a href="login.html" class="btn-send" style="display:block;text-align:center;text-decoration:none;margin-top:8px;">
            Back to Login
        </a>
    `;
}

function showError(message) {
    clearError();
    const sendBtn = document.querySelector('.btn-send');
    if (!sendBtn) return;

    const err = document.createElement('p');
    err.id          = 'fp-error';
    err.className   = 'fp-error-msg';
    err.textContent = message;
    sendBtn.before(err);
}

function clearError() {
    document.getElementById('fp-error')?.remove();
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function showDevLink(link) {
    const card = document.querySelector('.card');
    if (!card) return;

    // Remove existing dev banner if any
    document.getElementById('dev-reset-banner')?.remove();

    const banner = document.createElement('div');
    banner.id = 'dev-reset-banner';
    banner.style.cssText = `
        background:#fffbea;border:1.5px solid #f6c90e;border-radius:8px;
        padding:12px 14px;margin-top:14px;font-size:12px;
        font-family:'Manrope',sans-serif;
    `;
    banner.innerHTML = `
        <strong style="color:#7a5c00;">⚠ Dev Mode — Reset Link:</strong><br>
        <a href="${link}" style="color:#00802c;word-break:break-all;font-weight:600;">${link}</a>
    `;
    card.appendChild(banner);
}