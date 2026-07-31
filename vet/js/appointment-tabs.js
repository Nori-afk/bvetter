/* =============================================
   BVetter — Appointment page panel tabs
   File: vet/js/appointment-tabs.js
   Switches between the Appointments panel and the
   Castration & Spay panel inside appointment.html.
   ============================================= */

(function () {
	const tabBar = document.getElementById('appt-tabbar');
	if (!tabBar) return;

	const panels = {
		appointments: document.getElementById('panel-appointments'),
		'castration-spay': document.getElementById('panel-castration-spay')
	};

	tabBar.addEventListener('click', function (e) {
		const btn = e.target.closest('.tab-btn');
		if (!btn) return;
		const tab = btn.dataset.tab;

		tabBar.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b === btn));
		Object.keys(panels).forEach((key) => {
			if (panels[key]) panels[key].hidden = key !== tab;
		});
	});
}());
