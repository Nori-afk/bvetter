document.addEventListener("DOMContentLoaded", () => {
	const PROFILE_API = "/final-VBETTER/bvetter/api/users/profile.php";
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
		if (!response.ok || !result.success) {
			throw new Error(result.message || "Profile request failed.");
		}
		return result.data || result;
	}

	function fillProfile(profile) {
		const displayName = profile.fullName || session?.name || "User";
		document.getElementById("profile-name").textContent = displayName;

		const initialsEl = document.getElementById("avatar-initials");
		const avatar = document.getElementById("profile-avatar");
		if (initialsEl) initialsEl.textContent = displayName.charAt(0).toUpperCase();

		if (avatar && profile.avatarUrl) {
			avatar.src = profile.avatarUrl;
		} else if (avatar) {
			avatar.style.display = "none";
			if (initialsEl) initialsEl.style.display = "flex";
		}

		if (profileForm) {
			profileForm.elements.fullName.value = profile.fullName || "";
			profileForm.elements.email.value = profile.email || "";
			profileForm.elements.phone.value = profile.phone || "";
			profileForm.elements.education.value = profile.education || "";
			profileForm.elements.specialization.value = profile.specialization || "";
			profileForm.elements.role.value = profile.roleLabel || profile.role || "";
		}

		document.getElementById("stat-patients-today").textContent = profile.stats?.patientsToday ?? 0;
		document.getElementById("stat-total-patients").textContent = profile.stats?.totalPatients ?? 0;
		document.getElementById("stat-satisfaction").textContent = profile.stats?.satisfactionRate ?? "0.0";

		if (notificationForm) {
			notificationForm.elements.lostFoundAlerts.checked = Boolean(profile.notifications?.lostFoundAlerts);
			notificationForm.elements.appointmentReminders.checked = Boolean(profile.notifications?.appointmentReminders);
			notificationForm.elements.chatbotUpdates.checked = Boolean(profile.notifications?.chatbotUpdates);
		}
	}

	async function loadProfile() {
		if (!userId) {
			setMessage("No active session found.", "error");
			return;
		}
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
			email: profileForm.elements.email.value.trim(),
			phone: profileForm.elements.phone.value.trim(),
			education: profileForm.elements.education.value.trim(),
			specialization: profileForm.elements.specialization.value.trim()
		};
		try {
			const profile = await profileRequest("update", payload);
			fillProfile(profile);
			const nextSession = { ...session, name: profile.fullName, email: profile.email, phone: profile.phone };
			sessionStorage.setItem("vbetter_session", JSON.stringify(nextSession));
			setMessage("Profile saved.", "success");
		} catch (error) {
			setMessage(error.message, "error");
		}
	});

	notificationForm?.addEventListener("submit", async (event) => {
		event.preventDefault();
		try {
			const profile = await profileRequest("preferences", {
				lostFoundAlerts: notificationForm.elements.lostFoundAlerts.checked,
				appointmentReminders: notificationForm.elements.appointmentReminders.checked,
				chatbotUpdates: notificationForm.elements.chatbotUpdates.checked
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

	const btnManage2FA = document.getElementById("btnManage2FA");
	const twofaBadge = document.getElementById("twofaBadge");
	btnManage2FA?.addEventListener("click", () => {
		if (!twofaBadge) return;
		const isEnabled = twofaBadge.classList.contains("enabled");
		twofaBadge.classList.toggle("enabled", !isEnabled);
		twofaBadge.classList.toggle("disabled", isEnabled);
		twofaBadge.textContent = isEnabled ? "DISABLED" : "ENABLED";
		setMessage(isEnabled ? "Two-factor authentication disabled." : "Two-factor authentication enabled.", "success");
	});

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

	async function loadSchedule() {
		const list = document.getElementById("sched-list");
		if (!list) return;

		const iconColors = ["--teal", "--blue", "--purple", "--amber"];
		const iconEmojis = ["🐾", "🩺", "🐕", "🐈"];

		function badgeClass(status) {
			const s = String(status || "").toLowerCase().replace(/\s+/g, "_");
			if (s === "completed" || s === "complete") return "sched-badge--complete";
			if (s === "in_progress" || s === "in-progress") return "sched-badge--in-progress";
			if (s === "confirmed") return "sched-badge--confirmed";
			return "sched-badge--pending";
		}

		function badgeLabel(status) {
			const s = String(status || "").toLowerCase();
			if (s === "completed" || s === "complete") return "Complete";
			if (s === "in_progress" || s === "in-progress") return "In Progress";
			if (s === "confirmed") return "Confirmed";
			return "Pending";
		}

		function fmtTime(slot) {
			if (!slot) return { hm: "--:--", ampm: "" };
			const [h, m] = slot.split(":").map(Number);
			const ampm = h >= 12 ? "PM" : "AM";
			const hm = `${String(h % 12 || 12).padStart(2, "0")}:${String(m || 0).padStart(2, "0")}`;
			return { hm, ampm };
		}

		try {
			const today = new Date().toISOString().slice(0, 10);
			const formData = new FormData();
			formData.append("action", "list");
			formData.append("date", today);
			const response = await fetch("/bvetter/api/appointments/appointment.php", { method: "POST", body: formData });
			const result = await response.json();
			const items = (result.data || [])
				.filter((a) => (a.preferred_date || "").slice(0, 10) === today)
				.sort((a, b) => String(a.time_slot || "").localeCompare(String(b.time_slot || "")))
				.slice(0, 5);

			if (!items.length) {
				list.innerHTML = '<div class="sched-empty">No appointments scheduled for today.</div>';
				return;
			}

			list.innerHTML = items.map((item, i) => {
				const { hm, ampm } = fmtTime(item.time_slot);
				const petName = item.patient || item.pet?.name || "Patient";
				const breed = item.pet?.breed || item.breed || item.type || "";
				const service = item.service || item.appointment_type || "";
				const meta = [breed, service].filter(Boolean).join(" · ");
				const bc = badgeClass(item.status);
				const bl = badgeLabel(item.status);
				const isActive = bc === "sched-badge--in-progress";
				const iconColor = iconColors[i % iconColors.length];
				const iconEmoji = iconEmojis[i % iconEmojis.length];
				return `
					<div class="sched-row${isActive ? " sched-row--active" : ""}">
						<div class="sched-time">
							<span class="sched-time-hm">${hm}</span>
							<span class="sched-time-ampm">${ampm}</span>
						</div>
						<div class="sched-pet-icon sched-pet-icon${iconColor}">${iconEmoji}</div>
						<div class="sched-info">
							<div class="sched-pet-name">${petName}</div>
							${meta ? `<div class="sched-pet-meta">${meta}</div>` : ""}
						</div>
						<div class="sched-right">
							<span class="sched-badge ${bc}">${bl}</span>
							${isActive ? `<a href="/bvetter/vet/html/appointment.html" class="sched-arrow" title="Open appointment">&#8250;</a>` : ""}
						</div>
					</div>
				`;
			}).join("");
		} catch {
			list.innerHTML = '<div class="sched-empty">Could not load today\'s schedule.</div>';
		}
	}

	void loadProfile();
	void loadSchedule();
});
