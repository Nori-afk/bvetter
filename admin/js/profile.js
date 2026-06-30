document.addEventListener("DOMContentLoaded", () => {
	const tabs = Array.from(document.querySelectorAll(".profile-tab"));
	const panels = Array.from(document.querySelectorAll("[data-panel]"));

	tabs.forEach((tab) => {
		tab.addEventListener("click", () => {
			const tabId = tab.dataset.tab;

			tabs.forEach((item) => {
				item.classList.toggle("active", item === tab);
			});

			panels.forEach((panel) => {
				panel.hidden = panel.dataset.panel !== tabId;
			});
		});
	});
});
