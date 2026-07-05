/* =============================================
   BVETTER - Login Page JS
   Depends: ../../shared/js/auth.js and ../js/api.js
   ============================================= */

function togglePassword() {
  const pw = document.getElementById('loginPassword');
  if (!pw) return;
  pw.type = pw.type === 'password' ? 'text' : 'password';
}

async function handleLogin() {
  const email = document.getElementById('loginEmail')?.value.trim() || '';
  const password = document.getElementById('loginPassword')?.value || '';

  if (!email || !password) {
    alert('Please enter your email and password.');
    return;
  }

  try {
    const result = await api.login(email, password);

    if (!result.success) {
      alert(result.message || 'Invalid email or password.');
      return;
    }

    sessionStorage.setItem('vbetter_session', JSON.stringify(result.data));
    sessionStorage.setItem('bvetter_user', JSON.stringify(result.data));
    sessionStorage.setItem('bvetter_token', result.data.token || '');
    VBetterAuth.redirectToDashboard(result.data.role);
  } catch (error) {
    alert('Login failed. Please try again.');
  }
}
document.addEventListener('DOMContentLoaded',()=>{
  const email = document.getElementById('loginEmail');
  const password = document.getElementById('loginPassword');

  function loginButtons(event){
    if(event.key ==='Enter'){
      event.preventDefault();
      handleLogin();
    }
  }
  email.addEventListener('keydown', loginButtons);
  password.addEventListener('keydown', loginButtons);
})

