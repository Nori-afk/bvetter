/* =============================================
   BVETTER — Create Account JS
   File: js/signup.js
   Depends: api.js (for registration submit)

   Functions:
   - goTo(step)        — navigate between steps 1-4
   - updateStepper()   — update visual step circles
   - reviewStep()      — populate step 3 review fields
   - togglePw(id)      — show/hide password field
   - copyRef()         — copy reference number to clipboard

   TODO backend:
   - goTo(4): replace mock with api.register(data)
   - copyRef(): ref number comes from api.register() response
   ============================================= */

let currentStep = 1;

/* ── Step navigation ─────────────────────────── */
function goTo(step) {
  document.getElementById('step-' + currentStep).classList.remove('active');
  currentStep = step;
  document.getElementById('step-' + currentStep).classList.add('active');

  if (step === 3) reviewStep();
  updateStepper(step);
}

/* ── Stepper visual update ───────────────────── */
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

/* ── Populate review step from earlier inputs ─── */
function reviewStep() {
  const fullname  = document.getElementById('reg_fullname')?.value || '';
  const email     = document.getElementById('reg_email')?.value || '';
  const pw1       = document.getElementById('reg_pw1')?.value || '';
  const pw2       = document.getElementById('reg_pw2')?.value || '';
  const phone     = document.getElementById('rv_phone')?.value || '';
  const barangay  = document.getElementById('reg_barangay');
  const proofFile = document.getElementById('reg_proof');

  document.getElementById('rv_fullname').value = fullname;
  document.getElementById('rv_email').value = email;
  document.getElementById('rv_pw').value = pw1;
  document.getElementById('rv_pw2').value = pw2;
  document.getElementById('phone').value = phone;

  if (barangay) {
    document.getElementById('rv_barangay').value =
      barangay.options[barangay.selectedIndex]?.text || '';

    document.getElementById('rv_barangay_id').value =
      barangay.value || '';
  }

  document.getElementById('rv_proof_name').textContent =
    (proofFile && proofFile.files.length > 0)
      ? proofFile.files[0].name
      : 'No file selected';
}

/* ── Password visibility toggle ─────────────── */
function togglePw(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.type = el.type === 'password' ? 'text' : 'password';
}

/* ── Copy reference number to clipboard ─────────
   TODO backend: ref number from api.register() response,
   not hardcoded. Replace #ACC-2025-0000 dynamically.  */
function copyRef() {
  const ref = document.getElementById('reg_ref_number')?.textContent || '';
  navigator.clipboard.writeText(ref).catch(() => {});
}

async function submitRegistration() {
  const proofInput = document.getElementById('reg_proof');
  const password = document.getElementById('rv_pw')?.value || '';
  const confirmPassword = document.getElementById('rv_pw2')?.value || '';

  if (password !== confirmPassword) {
    alert('Passwords do not match.');
    return;
  }

  if (!proofInput?.files.length) {
    alert('Please upload your proof of residence.');
    return;
  }

  const formData = new FormData();
  formData.append('full_name', document.getElementById('rv_fullname')?.value || '');
  formData.append('email', document.getElementById('rv_email')?.value || '');
  formData.append('password', password);
  formData.append('phone_number', document.getElementById('phone')?.value || '');
formData.append('barangay_id', document.getElementById('rv_barangay_id')?.value || '');
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
  } catch (error) {
    alert('Registration failed. Please try again.');
  }
}

function checkMobile(){
  const mobile_num = document.getElementById('rv_phone').value;
  const starter = mobile_num.slice(0,3);
  if (starter !== '09' && starter !== '+63') {
    alert('Invalid phone number. Must start with 09 or +63');
    return false;
  }
}
async function loadBarangays() {
  const select = document.getElementById('reg_barangay');
  if (!select) return;

  try {
    const result = await api.getBarangays();

    if (!result.success) {
      alert(result.message || 'Failed to load barangays.');
      return;
    }

    select.innerHTML = '<option value="">Select Barangay</option>';

    result.data.forEach(barangay => {
      const option = document.createElement('option');
      option.value = barangay.id;
      option.textContent = barangay.name;
      select.appendChild(option);
    });
  } catch (error) {
    alert('Could not load barangays.');
  }
}

document.addEventListener('DOMContentLoaded', loadBarangays);
/* ── Initialize stepper on page load ─────────── */
updateStepper(1);
