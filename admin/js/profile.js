document.addEventListener("DOMContentLoaded", () => {
	const PROFILE_API = "/api/users/profile.php";
	// Was /api/users/sessions.php, which has never existed — so the Security
	// card's session list and its Revoke button silently failed on every load.
	// api/auth/session.php is the real endpoint; note it reads $_POST, so these
	// calls must send FormData, not a JSON body (see public/js/api.js).
	const SESSION_API = "/api/auth/session.php";
	const session = window.VBetterAuth?.getSession?.() || JSON.parse(localStorage.getItem("vbetter_session") || "null");
	const userId = session?.userId || session?.id || 0;

	const profileForm = document.getElementById("profile-form");
	const notificationForm = document.getElementById("notification-form");
	const message = document.getElementById("profile-message");

	function setMessage(text, type = "info") {
		if (!message) return;
		message.textContent = text;
		message.dataset.type = type;
	}

	// api/users/profile.php now authenticates with the bearer token and ignores
	// any user_id in the body, so this request must carry the token or it 401s.
	function authHeaders() {
		// Both are written at login; vet-api.js reads session.token, public/js
		// reads bvetter_token. Accept either so neither convention can break it.
		const token = session?.token || localStorage.getItem("bvetter_token");
		return token
			? { "Content-Type": "application/json", "Authorization": "Bearer " + token }
			: { "Content-Type": "application/json" };
	}

	async function profileRequest(action, payload = {}) {
		const response = await fetch(PROFILE_API, {
			method: "POST",
			headers: authHeaders(),
			body: JSON.stringify({ action, user_id: userId, ...payload })
		});
		const result = await response.json();
		if (!response.ok || !result.success) throw new Error(result.message || "Profile request failed.");
		return result.data || result;
	}

	function fillProfile(profile) {
		const displayName = profile.fullName || session?.name || "Administrator";
		document.getElementById("profile-name").textContent = displayName;

		const initialsEl = document.getElementById("avatar-initials");
		const avatar = document.getElementById("profile-avatar");
		if (initialsEl) initialsEl.textContent = displayName.charAt(0).toUpperCase();

		// Exactly one of the two is ever visible. The old version only ever
		// turned things ON — it showed the photo without hiding the initials —
		// so once the empty-src error handler had revealed the initials, both
		// circles rendered at once.
		function showAvatar(usePhoto) {
			if (avatar) avatar.hidden = !usePhoto;
			if (initialsEl) initialsEl.hidden = usePhoto;
		}

		if (avatar && profile.avatarUrl) {
			// Bound here rather than inline in the HTML: an inline onerror fires
			// against the placeholder src too, before this code ever runs.
			avatar.onerror = () => { avatar.onerror = null; showAvatar(false); };
			avatar.src = profile.avatarUrl;
			showAvatar(true);
		} else {
			showAvatar(false);
		}

		if (profileForm) {
			profileForm.elements.fullName.value = profile.fullName || "";
			profileForm.elements.email.value    = profile.email    || "";
			profileForm.elements.phone.value    = profile.phone    || "";
			profileForm.elements.role.value     = profile.roleLabel || profile.role || "System Administrator";
		}

		// KPI strip. profileStats() in api/users/profile.php fills these only for
		// role 'admin'; the em-dash stays for anyone else rather than showing a
		// zero that would read as a real measurement.
		const el = (id) => document.getElementById(id);
		const setStat = (id, value) => {
			const node = el(id);
			if (node) node.textContent = Number.isFinite(value) ? value.toLocaleString() : "—";
		};
		setStat("stat-total-accounts", profile.stats?.totalAccounts);
		setStat("stat-active-users",   profile.stats?.activeUsers);
		setStat("stat-site-updates",   profile.stats?.siteUpdates);
		if (el("stat-accounts-note") && profile.stats?.accountsNote) el("stat-accounts-note").textContent = profile.stats.accountsNote;
		if (el("stat-users-note")    && profile.stats?.usersNote)    el("stat-users-note").textContent    = profile.stats.usersNote;

		/* Password last-changed */
		const pwEl = el("pw-last-changed");
		if (pwEl) {
			if (profile.security?.passwordChangedAt) {
				// MySQL hands back "Y-m-d H:i:s"; Safari refuses that without the T.
				const d = new Date(String(profile.security.passwordChangedAt).replace(" ", "T"));
				const days = Math.floor((Date.now() - d.getTime()) / 86400000);
				pwEl.textContent = days <= 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;
			} else {
				// NULL means there genuinely is no record — the column only began
				// being stamped on 2026-08-22. Saying so beats a bare dash.
				pwEl.textContent = "never";
			}
		}

		/* 2FA status pill.
		   tfaEnabled is the EFFECTIVE state. An admin is challenged at login when
		   the site-wide switch is on even if they never opted in personally (see
		   requiresTwoFactor in api/config/login_flow.php), so reporting only the
		   personal flag told those admins "Not Enabled" while they were in fact
		   being asked for a code at every sign-in. */
		const tfaPill = el("tfa-status-pill");
		const tfaBtn = el("tfa-manage-btn");
		const tfaBtnLabel = el("tfa-manage-label");
		if (tfaPill) {
			const enabled = Boolean(profile.security?.tfaEnabled);
			tfaPill.textContent = profile.security?.tfaByPolicy
				? "Enabled · site policy"
				: enabled ? "Enabled" : "Not Enabled";
			tfaPill.className = `sec-status-pill sec-status-pill--${enabled ? "on" : "off"}`;
		}
		if (tfaBtn) {
			// The personal switch cannot turn 2FA off while site policy forces it,
			// so a "Turn Off" button would be a lie — point at the page that does
			// own that setting instead.
			tfaBtn.dataset.mode = profile.security?.tfaByPolicy ? "policy" : "personal";
			tfaBtn.dataset.enabled = profile.security?.tfaPersonal ? "1" : "0";
			if (tfaBtnLabel) {
				tfaBtnLabel.textContent = profile.security?.tfaByPolicy
					? "Security Settings"
					: profile.security?.tfaPersonal ? "Turn Off" : "Turn On";
			}
		}

		if (notificationForm) {
			// Default ON: absent/undefined must not read as "switched off", or a
			// first save would silently opt the admin out of everything.
			const n = notificationForm.elements;
			if (n.staffAppointmentAlerts) n.staffAppointmentAlerts.checked = profile.notifications?.staffAppointmentAlerts !== false;
			if (n.staffLostFoundAlerts)   n.staffLostFoundAlerts.checked   = profile.notifications?.staffLostFoundAlerts   !== false;
			if (n.staffTicketAlerts)      n.staffTicketAlerts.checked      = profile.notifications?.staffTicketAlerts      !== false;
			if (n.staffCspAlerts)         n.staffCspAlerts.checked         = profile.notifications?.staffCspAlerts         !== false;
			if (n.quietHoursEnabled)      n.quietHoursEnabled.checked      = Boolean(profile.notifications?.quietHoursEnabled);
			if (n.quietHoursStart)        n.quietHoursStart.value          = profile.notifications?.quietHoursStart || "22:00";
			if (n.quietHoursEnd)          n.quietHoursEnd.value            = profile.notifications?.quietHoursEnd || "07:00";
		}
	}

	/* ── Sessions ──
	   api/auth/session.php authenticates purely from the bearer token and reads
	   its action out of $_POST, so these go as FormData with no Content-Type of
	   our own — letting the browser set the multipart boundary. Sending JSON
	   here leaves $_POST empty and the endpoint answers "Unknown action". */
	function sessionRequest(action) {
		const token = session?.token || localStorage.getItem("bvetter_token");
		const body = new FormData();
		body.append("action", action);
		return fetch(SESSION_API, {
			method: "POST",
			headers: token ? { "Authorization": "Bearer " + token } : {},
			body
		});
	}

	async function loadSessions() {
		const countDesc = document.getElementById("session-count-desc");
		const list = document.getElementById("signin-list");

		function deviceIcon(label = "") {
			const isMobile = /mobile|android|iphone|ipad/i.test(label);
			return isMobile
				? `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>`
				: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>`;
		}

		// Epoch seconds from the server, not a parsed DATETIME string — the raw
		// string would be read as browser-local time and skew every "x ago".
		function timeAgo(epochSeconds) {
			if (!epochSeconds) return "unknown";
			const m = Math.floor((Date.now() / 1000 - epochSeconds) / 60);
			if (m < 1) return "just now";
			if (m < 60) return `${m}m ago`;
			const h = Math.floor(m / 60);
			if (h < 24) return `${h}h ago`;
			return `${Math.floor(h / 24)}d ago`;
		}

		// Trims the last octet of IPv4 and the last group of IPv6. The previous
		// regex only matched IPv4, so a v6 address was printed in full.
		function maskIp(ip) {
			if (!ip) return "";
			if (ip.includes(":")) return ip.replace(/[0-9a-f]*$/i, "xxxx");
			return ip.replace(/\.\d+$/, ".xxx");
		}

		function escapeHtml(value) {
			return String(value ?? "").replace(/[&<>"']/g, (c) =>
				({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
		}

		try {
			const resp = await sessionRequest("list");
			const result = await resp.json();
			if (!resp.ok || !result.success) throw new Error(result.message || "Session list failed.");
			const sessions = result.data || [];

			// The list is the caller's own sessions, current one included, so
			// "other" devices is one fewer than the row count.
			const others = sessions.filter((s) => !s.isCurrent).length;
			if (countDesc) {
				countDesc.textContent = others
					? `${others} other active session${others > 1 ? "s" : ""} across devices`
					: "No other active sessions";
			}

			if (!list) return;
			if (!sessions.length) {
				list.innerHTML = '<div class="signin-empty">No sign-in history available.</div>';
				return;
			}

			list.innerHTML = sessions.slice(0, 5).map((s) => {
				// device_label is already "Chrome on Windows" — the old code
				// re-derived that by sniffing a userAgent field this endpoint
				// does not return, so every row read "Browser on Device".
				const device = s.device || "Unknown device";
				const meta = [maskIp(s.ip), s.location, timeAgo(s.lastActivityEpoch)]
					.filter(Boolean).join(" · ");
				const okIcon = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
				return `
				<div class="signin-row">
					<div class="signin-icon">${deviceIcon(device)}</div>
					<div class="signin-body">
						<div class="signin-device">
							${escapeHtml(device)}
							${s.isCurrent ? '<span class="signin-current-badge">Current</span>' : ""}
						</div>
						<div class="signin-meta">${escapeHtml(meta)}</div>
					</div>
					<div class="signin-status signin-status--ok">${okIcon}</div>
				</div>`;
			}).join("");
		} catch {
			if (countDesc) countDesc.textContent = "Session data unavailable";
			if (list) list.innerHTML = '<div class="signin-empty">Could not load sign-in history.</div>';
		}
	}

	async function loadProfile() {
		if (!userId) { setMessage("No active session found.", "error"); return; }
		try {
			const profile = await profileRequest("get");
			fillProfile(profile);
		} catch (error) {
			setMessage(error.message, "error");
		}
	}

	profileForm?.addEventListener("submit", async (event) => {
		event.preventDefault();
		const payload = {
			fullName: profileForm.elements.fullName.value.trim(),
			email:    profileForm.elements.email.value.trim(),
			phone:    profileForm.elements.phone.value.trim()
		};
		try {
			const profile = await profileRequest("update", payload);
			fillProfile(profile);
			const next = { ...session, name: profile.fullName, email: profile.email, phone: profile.phone };
			localStorage.setItem("vbetter_session", JSON.stringify(next));
			setMessage("Profile saved.", "success");
		} catch (error) {
			setMessage(error.message, "error");
		}
	});

	notificationForm?.addEventListener("submit", async (event) => {
		event.preventDefault();
		const n = notificationForm.elements;
		try {
			const profile = await profileRequest("preferences", {
				staffAppointmentAlerts: n.staffAppointmentAlerts?.checked ?? true,
				staffLostFoundAlerts:   n.staffLostFoundAlerts?.checked   ?? true,
				staffTicketAlerts:      n.staffTicketAlerts?.checked      ?? true,
				staffCspAlerts:         n.staffCspAlerts?.checked         ?? true,
				quietHoursEnabled:      n.quietHoursEnabled?.checked      ?? false,
				quietHoursStart:        n.quietHoursStart?.value          || "22:00",
				quietHoursEnd:          n.quietHoursEnd?.value            || "07:00"
			});
			fillProfile(profile);
			setMessage("Notification preferences saved.", "success");
		} catch (error) {
			setMessage(error.message, "error");
		}
	});

	const pwOverlay = document.getElementById("pwModalOverlay");
	const pwForm = document.getElementById("pw-update-form");
	const pwMessage = document.getElementById("pwModalMessage");

	function setPwMessage(text, type = "info") {
		if (!pwMessage) return;
		pwMessage.textContent = text;
		pwMessage.dataset.type = type;
	}

	function openPasswordModal() {
		pwForm?.reset();
		setPwMessage("");
		if (pwOverlay) pwOverlay.hidden = false;
		document.getElementById("pw-current")?.focus();
	}

	function closePasswordModal() {
		if (pwOverlay) pwOverlay.hidden = true;
	}

	document.getElementById("update-password-btn")?.addEventListener("click", openPasswordModal);
	document.getElementById("pwModalClose")?.addEventListener("click", closePasswordModal);
	document.getElementById("pwModalCancel")?.addEventListener("click", closePasswordModal);
	pwOverlay?.addEventListener("click", (event) => {
		if (event.target === pwOverlay) closePasswordModal();
	});

	pwForm?.addEventListener("submit", async (event) => {
		event.preventDefault();
		const currentPassword = pwForm.elements.currentPassword.value;
		const newPassword = pwForm.elements.newPassword.value;
		const confirmPassword = pwForm.elements.confirmPassword.value;

		if (!currentPassword) return setPwMessage("Enter your current password.", "error");
		if (newPassword.length < 12) return setPwMessage("New password must be at least 12 characters.", "error");
		if (newPassword !== confirmPassword) return setPwMessage("New password and confirmation do not match.", "error");

		const submitBtn = pwForm.querySelector('button[type="submit"]');
		submitBtn.disabled = true;
		try {
			await profileRequest("password", { currentPassword, newPassword });
			closePasswordModal();
			// Clears any forced-upgrade hold, so navigation is free again.
			window.VBetterAuth?.clearPasswordUpgrade?.();
			setMessage("Password updated.", "success");
			// Refreshes "Last changed", which the server has just stamped.
			void loadProfile();
		} catch (error) {
			setPwMessage(error.message, "error");
		} finally {
			submitBtn.disabled = false;
		}
	});

	document.getElementById("revoke-sessions-btn")?.addEventListener("click", async () => {
		if (!(await vbConfirm("Revoke all other sessions? You will remain signed in on this device.", "Revoke"))) return;
		try {
			// 'end_others' is what api/auth/session.php calls this; the old
			// 'revoke_others' was never a recognised action anywhere.
			const resp = await sessionRequest("end_others");
			const result = await resp.json();
			if (!resp.ok || !result.success) throw new Error(result.message || "Revoke failed.");
			setMessage("All other sessions revoked.", "success");
			void loadSessions();
		} catch {
			setMessage("Could not revoke sessions.", "error");
		}
	});

	/* Two-factor. Was an unwired button with no id at all. */
	document.getElementById("tfa-manage-btn")?.addEventListener("click", async (event) => {
		const btn = event.currentTarget;

		// Site policy owns the setting in this case, and it lives on a different
		// page — flipping the personal flag here would not change what the admin
		// experiences at login.
		if (btn.dataset.mode === "policy") {
			window.location.href = "manage-security.html";
			return;
		}

		const turningOn = btn.dataset.enabled !== "1";
		const prompt = turningOn
			? "Turn on two-factor authentication? You'll be emailed a 6-digit code at every sign-in."
			: "Turn off two-factor authentication? Your account will be protected by password alone.";
		if (!(await vbConfirm(prompt, turningOn ? "Turn On" : "Turn Off"))) return;

		btn.disabled = true;
		try {
			const profile = await profileRequest("two_factor", { enabled: turningOn });
			fillProfile(profile);
			setMessage(turningOn ? "Two-factor authentication enabled." : "Two-factor authentication disabled.", "success");
		} catch (error) {
			setMessage(error.message, "error");
		} finally {
			btn.disabled = false;
		}
	});

	void loadProfile();
	void loadSessions();
});
