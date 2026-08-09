/* =============================================
   BVetter - Login Page JS
   Depends: ../../shared/js/auth.js and ../js/api.js
   ============================================= */

function togglePassword() {
  const pw = document.getElementById('loginPassword');
  if (!pw) return; //short confirmation if the value are missing or walang value if not
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

/* Credentials held in memory between the password step and the OTP step —
   the server re-checks them on every call, this just saves retyping. */
let pendingLogin = null;

function completeLogin(result) {
  sessionStorage.setItem('vbetter_session', JSON.stringify(result.data));
  sessionStorage.setItem('bvetter_user', JSON.stringify(result.data));
  sessionStorage.setItem('bvetter_token', result.data.token || '');
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

async function handleLogin(){
  const email = document.getElementById('loginEmail')?.value.trim() || '';
  const password = document.getElementById('loginPassword')?.value || '';

  if (!email || !password){
    showNotice('Please enter your email and password.');
    return
  }
  try{
    const result = await api.login(email,password);

    if(!result.success){
      showNotice(result.message || 'Invalid email or password.');
      return;
    }

    if(result.requires_2fa){
      pendingLogin ={email,password};
      showOtpStep(result.message);
      return
    }
    completeLogin(result)
  }catch(error){
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
    const result = await api.login(pendingLogin.email, pendingLogin.password, code);

    if (!result.success) {
      showNotice(result.message || 'Verification failed. Please try again.');
      return;
    }

    // Server may re-challenge (e.g. code expired and a new one was emailed)
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
    const result = await api.login(pendingLogin.email, pendingLogin.password);
    showNotice(result.message || 'A new code has been sent.');
  } catch (error) {
    showNotice('Could not resend the code. Please try again.');
  }
}

document.addEventListener('DOMContentLoaded',()=>{
  const email = document.getElementById('loginEmail');
  const password = document.getElementById('loginPassword');
  const otp = document.getElementById('loginOtp');

  function loginButtons(event){
    if(event.key ==='Enter'){
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
})

