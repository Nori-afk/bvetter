document.addEventListener("DOMContentLoaded", () => {
	const PROFILE_API = "/final-VBETTER/bvetter/api/users/profile.php";
	const SESSION_API = "/final-VBETTER/bvetter/api/users/sessions.php";
	const session = window.VBetterAuth?.getSession?.() || JSON.parse(sessionStorage.getItem("vbetter_session") || "null");
	const userId = session?.userId || session?.id || 0;

	const profileForm = document.getElementById("profile-form");
	const notificationForm = document.getElementById("notification-form");
	const message = document.getElementById("profile-message");

	function setMessage(text, type = "info") {
		if (!message) return;
		message.textContent = text;
		message.dataset.type = type;
	}

	async function profileRequest(action, payload = {}) {
		const response = await fetch(PROFILE_API, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
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

		if (avatar && profile.avatarUrl) {
			avatar.src = profile.avatarUrl;
			avatar.style.display = "block";
		} else if (avatar) {
			avatar.style.display = "none";
			if (initialsEl) initialsEl.style.display = "flex";
		}

		if (profileForm) {
			profileForm.elements.fullName.value = profile.fullName || "";
			profileForm.elements.email.value    = profile.email    || "";
			profileForm.elements.phone.value    = profile.phone    || "";
			profileForm.elements.role.value     = profile.roleLabel || profile.role || "System Administrator";
		}

		const el = (id) => document.getElementById(id);
		if (el("stat-total-accounts")) el("stat-total-accounts").textContent = profile.stats?.totalAccounts ?? "—";
		if (el("stat-active-users"))   el("stat-active-users").textContent   = profile.stats?.activeUsers   ?? "—";
		if (el("stat-site-updates"))   el("stat-site-updates").textContent   = profile.stats?.siteUpdates   ?? "—";
		if (el("stat-uptime"))         el("stat-uptime").textContent         = profile.stats?.uptime        ?? "99.9%";
		if (el("stat-accounts-note") && profile.stats?.accountsNote) el("stat-accounts-note").textContent = profile.stats.accountsNote;
		if (el("stat-users-note")    && profile.stats?.usersNote)    el("stat-users-note").textContent    = profile.stats.usersNote;

		/* Password last-changed */
		const pwEl = el("pw-last-changed");
		if (pwEl) {
			if (profile.security?.passwordChangedAt) {
				const d = new Date(profile.security.passwordChangedAt);
				const days = Math.floor((Date.now() - d) / 86400000);
				pwEl.textContent = days === 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;
			} else {
				pwEl.textContent = "—";
			}
		}

		/* 2FA status pill */
		const tfaPill = el("tfa-status-pill");
		if (tfaPill) {
			const enabled = Boolean(profile.security?.tfaEnabled);
			tfaPill.textContent = enabled ? "Enabled" : "Not Enabled";
			tfaPill.className = `sec-status-pill sec-status-pill--${enabled ? "on" : "off"}`;
		}

		if (notificationForm) {
			const n = notificationForm.elements;
			if (n.newAccountRegistrations) n.newAccountRegistrations.checked = Boolean(profile.notifications?.newAccountRegistrations);
			if (n.systemAlerts)            n.systemAlerts.checked            = Boolean(profile.notifications?.systemAlerts);
			if (n.contentUpdates)          n.contentUpdates.checked          = Boolean(profile.notifications?.contentUpdates);
			if (n.weeklySummary)           n.weeklySummary.checked           = Boolean(profile.notifications?.weeklySummary);
			if (n.securityAlerts)          n.securityAlerts.checked          = profile.notifications?.securityAlerts !== false;
			if (n.quietHoursEnabled)       n.quietHoursEnabled.checked       = Boolean(profile.notifications?.quietHoursEnabled);
			if (n.quietHoursStart)         n.quietHoursStart.value           = profile.notifications?.quietHoursStart || "22:00";
			if (n.quietHoursEnd)           n.quietHoursEnd.value             = profile.notifications?.quietHoursEnd || "07:00";
		}
	}

	/* ── Sessions ── */
	async function loadSessions() {
		const countDesc = document.getElementById("session-count-desc");
		const list = document.getElementById("signin-list");

		function deviceIcon(ua = "") {
			const isMobile = /mobile|android|iphone|ipad/i.test(ua);
			return isMobile
				? `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>`
				: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>`;
		}

		function timeAgo(iso) {
			if (!iso) return "—";
			const diff = Date.now() - new Date(iso).getTime();
			const m = Math.floor(diff / 60000);
			if (m < 1) return "just now";
			if (m < 60) return `${m}m ago`;
			const h = Math.floor(m / 60);
			if (h < 24) return `${h}h ago`;
			return `${Math.floor(h / 24)}d ago`;
		}

		try {
			const resp = await fetch(SESSION_API, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ action: "list", user_id: userId })
			});
			const result = await resp.json();
			const sessions = result.data || [];

			if (countDesc) {
				countDesc.textContent = sessions.length
					? `${sessions.length} active session${sessions.length > 1 ? "s" : ""} across devices`
					: "No other active sessions";
			}

			if (!list) return;
			if (!sessions.length) {
				list.innerHTML = '<div class="signin-empty">No sign-in history available.</div>';
				return;
			}

			list.innerHTML = sessions.slice(0, 5).map((s, i) => {
				const isCurrent = i === 0 || s.isCurrent;
				const ua = s.userAgent || "";
				const browser = ua.includes("Chrome") ? "Chrome" : ua.includes("Firefox") ? "Firefox" : ua.includes("Safari") ? "Safari" : ua.includes("Edge") ? "Edge" : "Browser";
				const os = ua.includes("Windows") ? "Windows" : ua.includes("Mac") ? "macOS" : ua.includes("Linux") ? "Linux" : ua.includes("Android") ? "Android" : ua.includes("iPhone") ? "iPhone" : "Device";
				const ip = s.ip ? s.ip.replace(/\.\d+$/, ".xxx") : "—";
				const location = s.location || "";
				const meta = [ip, location, timeAgo(s.lastActive || s.createdAt)].filter(Boolean).join(" · ");
				const okIcon = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
				return `
				<div class="signin-row">
					<div class="signin-icon">${deviceIcon(ua)}</div>
					<div class="signin-body">
						<div class="signin-device">
							${browser} on ${os}
							${isCurrent ? '<span class="signin-current-badge">Current</span>' : ""}
						</div>
						<div class="signin-meta">${meta}</div>
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
			sessionStorage.setItem("vbetter_session", JSON.stringify(next));
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
				newAccountRegistrations: n.newAccountRegistrations?.checked ?? false,
				systemAlerts:            n.systemAlerts?.checked            ?? false,
				contentUpdates:          n.contentUpdates?.checked          ?? false,
				weeklySummary:           n.weeklySummary?.checked           ?? false,
				securityAlerts:          n.securityAlerts?.checked          ?? true,
				quietHoursEnabled:       n.quietHoursEnabled?.checked       ?? false,
				quietHoursStart:         n.quietHoursStart?.value           || "22:00",
				quietHoursEnd:           n.quietHoursEnd?.value             || "07:00"
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
		if (newPassword.length < 8) return setPwMessage("New password must be at least 8 characters.", "error");
		if (newPassword !== confirmPassword) return setPwMessage("New password and confirmation do not match.", "error");

		const submitBtn = pwForm.querySelector('button[type="submit"]');
		submitBtn.disabled = true;
		try {
			await profileRequest("password", { currentPassword, newPassword });
			closePasswordModal();
			setMessage("Password updated.", "success");
		} catch (error) {
			setPwMessage(error.message, "error");
		} finally {
			submitBtn.disabled = false;
		}
	});

	document.getElementById("revoke-sessions-btn")?.addEventListener("click", async () => {
		if (!window.confirm("Revoke all other sessions? You will remain signed in on this device.")) return;
		try {
			await fetch(SESSION_API, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ action: "revoke_others", user_id: userId })
			});
			setMessage("All other sessions revoked.", "success");
			void loadSessions();
		} catch {
			setMessage("Could not revoke sessions.", "error");
		}
	});

	void loadProfile();
	void loadSessions();
});
