document.addEventListener("DOMContentLoaded", () => {
	const PROFILE_API = "/Final-Backend/backend/users/profile.php";
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
		document.getElementById("profile-name").textContent = profile.fullName || session?.name || "User";
		document.getElementById("profile-member-since").textContent = `${profile.roleLabel || "User"}${profile.memberSince ? ` since ${profile.memberSince}` : ""}`;
		const avatar = document.getElementById("profile-avatar");
		if (avatar && profile.avatarUrl) avatar.src = profile.avatarUrl;

		if (profileForm) {
			profileForm.elements.fullName.value = profile.fullName || "";
			profileForm.elements.email.value = profile.email || "";
			profileForm.elements.phone.value = profile.phone || "";
			profileForm.elements.role.value = profile.roleLabel || profile.role || "";
		}

		document.getElementById("stat-patients-today").textContent = profile.stats?.patientsToday ?? 0;
		document.getElementById("stat-surgeries").textContent = profile.stats?.surgeriesPerformed ?? 0;
		document.getElementById("stat-treatment-time").textContent = profile.stats?.avgTreatmentTime ?? "45m";
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
			phone: profileForm.elements.phone.value.trim()
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

	document.getElementById("update-password-btn")?.addEventListener("click", async () => {
		const currentPassword = window.prompt("Current password");
		if (!currentPassword) return;
		const newPassword = window.prompt("New password, minimum 8 characters");
		if (!newPassword) return;
		try {
			await profileRequest("password", { currentPassword, newPassword });
			setMessage("Password updated.", "success");
		} catch (error) {
			setMessage(error.message, "error");
		}
	});

	void loadProfile();
});
