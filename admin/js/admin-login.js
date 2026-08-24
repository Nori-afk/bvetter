/* =============================================
   BVetter - Admin Login Page JS
   Depends: ../../shared/js/auth.js and ../../public/js/api.js
   Mirrors public/js/login.js but calls api.adminLogin() instead of
   api.login() — see api/auth/admin-login.php.
   ============================================= */

function togglePassword() {
  const pw = document.getElementById('loginPassword');
  if (!pw) return;
  pw.type = pw.type === 'password' ? 'text' : 'password';
}

/* ══════════════════════════════════════════════
   NOTICE MODAL — replaces browser alert()
══════════════════════════════════════════════ */

function showNotice(message) {
  const messageEl = document.getElementById('noticeMessage');
  if (messageEl) messageEl.textContent = message;
  document.getElementById('noticeModal')?.classList.add('open');
}

function closeModal(id) {
  document.getElementById(id)?.classList.remove('open');
}

function closeModalOutside(event, id) {
  if (event.target.id === id) closeModal(id);
}

let pendingLogin = null;

/* ══════════════════════════════════════════════
   POST-LOGIN DEEP LINK (?next=)
   ══════════════════════════════════════════════
   Staff-alert emails (e.g. a new account application, see
   api/config/notifications.php) link here as
   ops-3bab26d632.html?next=account-management.html%3Freview%3D42 — because
   the shared auth guard's login redirect (shared/js/auth.js) drops the
   original URL entirely, an admin opening that link on a phone with no
   existing session would otherwise land on the plain dashboard and have to
   find the applicant by hand.

   Handled only here, not in the shared guard: this page is the one place
   that's admin-only by construction, so validating and consuming `next`
   here can't affect the vet or owner login flows.

   Validation is deliberately strict — this is a login page, the classic
   target for an open-redirect (a crafted link that logs a real user in and
   then bounces them to an attacker's site). Only a bare same-directory
   filename plus an optional query string is accepted: no scheme, no
   "//host" (protocol-relative), no leading "/", no "..". */
function safeNextPath(next) {
  if (typeof next !== 'string') return null;
  return /^[A-Za-z0-9_-]+\.html(\?[A-Za-z0-9_=&%.-]*)?$/.test(next) ? next : null;
}

function completeLogin(result) {
  localStorage.setItem('vbetter_session', JSON.stringify(result.data));
  localStorage.setItem('bvetter_user', JSON.stringify(result.data));
  localStorage.setItem('bvetter_token', result.data.token || '');

  const next = safeNextPath(new URLSearchParams(window.location.search).get('next'));
  if (next) {
    window.location.href = next;
    return;
  }
  VBetterAuth.redirectToDashboard(result.data.role);
}

function showOtpStep(message) {
  document.getElementById('credsStep').style.display = 'none';
  document.getElementById('otpStep').style.display = '';
  const subtitle = document.getElementById('otpSubtitle');
  if (subtitle && message) subtitle.textContent = message;
  const otpInput = document.getElementById('loginOtp');
  if (otpInput) {
    otpInput.value = '';
    otpInput.focus();
  }
}

function backToLogin(event) {
  if (event) event.preventDefault();
  pendingLogin = null;
  document.getElementById('otpStep').style.display = 'none';
  document.getElementById('credsStep').style.display = '';
}

async function handleLogin() {
  const email = document.getElementById('loginEmail')?.value.trim() || '';
  const password = document.getElementById('loginPassword')?.value || '';

  if (!email || !password) {
    showNotice('Please enter your email and password.');
    return;
  }
  try {
    const result = await api.adminLogin(email, password);

    if (!result.success) {
      showNotice(result.message || 'Invalid email or password.');
      return;
    }

    if (result.requires_2fa) {
      pendingLogin = { email, password };
      showOtpStep(result.message);
      return;
    }
    completeLogin(result);
  } catch (error) {
    showNotice('Login failed. Please try again.');
  }
}

async function handleVerifyOtp() {
  if (!pendingLogin) {
    backToLogin();
    return;
  }

  const code = document.getElementById('loginOtp')?.value.trim() || '';
  if (!/^\d{6}$/.test(code)) {
    showNotice('Please enter the 6-digit code from your email.');
    return;
  }

  try {
    const result = await api.adminLogin(pendingLogin.email, pendingLogin.password, code);

    if (!result.success) {
      showNotice(result.message || 'Verification failed. Please try again.');
      return;
    }

    if (result.requires_2fa) {
      showOtpStep(result.message);
      return;
    }

    completeLogin(result);
  } catch (error) {
    showNotice('Verification failed. Please try again.');
  }
}

async function handleResendOtp(event) {
  if (event) event.preventDefault();
  if (!pendingLogin) {
    backToLogin();
    return;
  }

  try {
    const result = await api.adminLogin(pendingLogin.email, pendingLogin.password);
    showNotice(result.message || 'A new code has been sent.');
  } catch (error) {
    showNotice('Could not resend the code. Please try again.');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const email = document.getElementById('loginEmail');
  const password = document.getElementById('loginPassword');
  const otp = document.getElementById('loginOtp');

  function loginButtons(event) {
    if (event.key === 'Enter') {
      event.preventDefault();
      handleLogin();
    }
  }
  email.addEventListener('keydown', loginButtons);
  password.addEventListener('keydown', loginButtons);
  otp?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      handleVerifyOtp();
    }
  });
});
