let diseaseAnalyticsData = {
	filters: ["All Diseases", "Parvovirus", "Distemper", "Leptospirosis", "Rabies"],
	selectedDisease: "Parvovirus",
	kpis: [
		{ label: "Total Patients This Month", value: "120", trend: "+2% higher compared to last month" },
		{ label: "Most Common Disease", value: "Canine Parvovirus", trend: "Mostly dog and cat" },
		{ label: "Most Active Barangay", value: "Tangos", trend: "Barangay Matangtubig is second" },
		{ label: "Auto Alerts", value: "08", trend: "3 critical, 5 monitor" }
	],
	predictionSummary: {
		total: 24,
		label: "Predicted high-risk zones"
	},
	sources: [
		{ name: "Patient Records", status: "Live" },
		{ name: "Baliwag City", status: "Geographic Layer" },
		{ name: "Symptom Logs", status: "Model Input Aggregation" }
	],
	actualCases: [
		{ barangay: "Poblacion", value: 5 },
		{ barangay: "San Jose", value: 3 },
		{ barangay: "Tangos", value: 9 },
		{ barangay: "Matangtubig", value: 2 },
		{ barangay: "Makinabang", value: 4 },
		{ barangay: "Virgen delas Flores", value: 4 },
		{ barangay: "Tilapayong", value: 4 },
		{ barangay: "Tibig", value: 7 },
		{ barangay: "Tiaong", value: 2 },
		{ barangay: "Santo Nino", value: 1 },
		{ barangay: "Santa Cristo", value: 3 },
		{ barangay: "Santa Barbara", value: 2 }
	],
	predictedCases: [
		{ barangay: "Poblacion", value: 8.9 },
		{ barangay: "San Jose", value: 7.1 },
		{ barangay: "Tangos", value: 9.6 },
		{ barangay: "Matangtubig", value: 4.4 },
		{ barangay: "Makinabang", value: 5.2 },
		{ barangay: "Virgen delas Flores", value: 5.7 },
		{ barangay: "Tilapayong", value: 3.8 },
		{ barangay: "Tibig", value: 7.2 },
		{ barangay: "Tiaong", value: 2.6 },
		{ barangay: "Santo Nino", value: 2.1 },
		{ barangay: "Santa Cristo", value: 4.9 },
		{ barangay: "Santa Barbara", value: 3.1 }
	],
	insights: [
		{
			id: "tangos",
			barangay: "Tangos",
			disease: "Parvovirus",
			cases: 18,
			avg: 16.2,
			recommendation: "Deploy barangay health workers for door-to-door visual screening and pet registry verification.",
			comparisons: [
				{ label: "Parvovirus Containment", value: 86, color: "#2ca0f0" },
				{ label: "Brgy Average", value: 79, color: "#3d6670" },
				{ label: "Other Barangay", value: 78, color: "#4c6f77" },
				{ label: "Highest Ever", value: 93, color: "#0b7a2c" }
			],
			predicted: [
				{ label: "Parvovirus Containment", value: 84, color: "#2ca0f0" },
				{ label: "Brgy Average", value: 79, color: "#3d6670" }
			],
			protocol: {
				classification: "Grade 4 Outbreak Risk",
				title: "Parvovirus Containment Protocol",
				description: "Standardized biosafety level emergency response initiated via automated surveillance trigger.",
				steps: [
					{ level: "red", title: "Immediate: Field Deployment", detail: "Deploy Barangay Health Workers for door-to-door visual screening and pet registry verification." },
					{ level: "blue", title: "Within 24hrs: Regulatory Reporting", detail: "Mandatory escalation report to Municipal Health Office and Provincial Veterinary Services." },
					{ level: "green", title: "Preventive: Sanitation Drive", detail: "Conduct community sanitation sweep and distribute veterinary-grade disinfectants to high-risk households." },
					{ level: "gray", title: "Monitoring: Case Reporting", detail: "Daily case reporting for 14 days until incubation window clears and secondary screening is complete." }
				]
			}
		},
		{
			id: "poblacion",
			barangay: "Poblacion",
			disease: "Parvovirus",
			cases: 12,
			avg: 10.4,
			recommendation: "Open temporary triage point and prioritize severe symptom tracking within 48 hours.",
			comparisons: [
				{ label: "Parvovirus Containment", value: 67, color: "#2ca0f0" },
				{ label: "Brgy Average", value: 56, color: "#3d6670" },
				{ label: "Other Barangay", value: 61, color: "#4c6f77" },
				{ label: "Highest Ever", value: 83, color: "#0b7a2c" }
			],
			predicted: [
				{ label: "Parvovirus Containment", value: 65, color: "#2ca0f0" },
				{ label: "Brgy Average", value: 58, color: "#3d6670" }
			],
			protocol: {
				classification: "Grade 3 Elevated Risk",
				title: "Targeted Community Response",
				description: "Escalated monitoring with staged interventions for dense residential clusters.",
				steps: [
					{ level: "red", title: "Immediate: Cluster Validation", detail: "Confirm active symptom clusters from recent reports." },
					{ level: "blue", title: "Within 24hrs: Vet Coordination", detail: "Coordinate with district vet teams for vaccination queueing." },
					{ level: "green", title: "Preventive: Community Briefing", detail: "Run barangay broadcast for early symptom recognition." },
					{ level: "gray", title: "Monitoring: Follow-up", detail: "Track trend every 12 hours and auto-adjust risk label." }
				]
			}
		}
	],
	map: {
		center: [14.9577, 120.9055],
		zoom: 14,
		metrics: [
			{ label: "Total Patients", value: "1,284", trend: "+16% from last month" },
			{ label: "Common Diseases", value: "Parvovirus", trend: "42% of recent admissions" },
			{ label: "Active Barangay", value: "Tangos", trend: "Immediate focus area" }
		],
		hotspots: [
			{ id: "h1", barangay: "Tangos", disease: "Parvovirus", risk: "critical", cases: 42, predicted: 51, lat: 14.9599, lng: 120.9083, intensity: 1.0 },
			{ id: "h2", barangay: "Matangtubig", disease: "Parvovirus", risk: "stable", cases: 16, predicted: 22, lat: 14.9516, lng: 120.8979, intensity: 0.55 },
			{ id: "h3", barangay: "Makinabang", disease: "Parvovirus", risk: "monitor", cases: 20, predicted: 27, lat: 14.9584, lng: 120.9001, intensity: 0.72 },
			{ id: "h4", barangay: "San Jose", disease: "Parvovirus", risk: "critical", cases: 32, predicted: 38, lat: 14.9542, lng: 120.9099, intensity: 0.92 },
			{ id: "h5", barangay: "Poblacion", disease: "Parvovirus", risk: "monitor", cases: 18, predicted: 23, lat: 14.9621, lng: 120.9017, intensity: 0.66 },
			{ id: "h6", barangay: "Virgen delas Flores", disease: "Parvovirus", risk: "monitor", cases: 21, predicted: 26, lat: 14.9568, lng: 120.8947, intensity: 0.69 }
		],
		forecast: [22, 29, 31, 34, 28, 38, 44, 49]
	}
};

const state = {
	selectedInsightId: diseaseAnalyticsData.insights[0].id,
	mapActionMode: false,
	map: null,
	heatLayer: null,
	hotspotMarkers: []
};

async function initDiseaseAnalytics() {
	await loadDiseaseAnalytics();
	bindEvents();
	renderOverview();
	renderInsightPanel();
	renderMapPanel();
}

async function loadDiseaseAnalytics(disease = "All Diseases") {
	if (!window.VetAPI?.getDiseaseAnalytics) return;
	const response = await window.VetAPI.getDiseaseAnalytics(disease);
	if (response.ok && response.data && Object.keys(response.data).length) {
		diseaseAnalyticsData = response.data;
		state.selectedInsightId = diseaseAnalyticsData.insights?.[0]?.id || "";
	}
}

function bindEvents() {
	document.getElementById("openMapBtn").addEventListener("click", () => switchPanel("mapPanel"));
	document.getElementById("backFromMapBtn").addEventListener("click", () => switchPanel("overviewPanel"));
	document.getElementById("backToOverviewBtn").addEventListener("click", () => switchPanel("overviewPanel"));
	document.getElementById("toggleActionBtn").addEventListener("click", toggleMapActionMode);

	const filter = document.getElementById("diseaseFilter");
	diseaseAnalyticsData.filters.forEach((item) => {
		const option = document.createElement("option");
		option.value = item;
		option.textContent = item;
		if (item === diseaseAnalyticsData.selectedDisease) {
			option.selected = true;
		}
		filter.appendChild(option);
	});

	filter.addEventListener("change", (event) => {
		loadDiseaseAnalytics(event.target.value).then(() => {
			state.mapActionMode = false;
			if (state.map) {
				state.hotspotMarkers.forEach((marker) => marker.remove());
				state.hotspotMarkers = [];
				if (state.heatLayer) state.heatLayer.remove();
				const heatPoints = diseaseAnalyticsData.map.hotspots.map((spot) => [spot.lat, spot.lng, spot.intensity]);
				state.heatLayer = L.heatLayer(heatPoints, {
					radius: 45,
					blur: 30,
					minOpacity: 0.5,
					gradient: {
						0.3: "#6ec7ff",
						0.55: "#fff27a",
						0.75: "#ff9248",
						1.0: "#e53030"
					}
				}).addTo(state.map);
				diseaseAnalyticsData.map.hotspots.forEach((spot) => {
					const color = getRiskColor(spot.risk);
					const marker = L.circleMarker([spot.lat, spot.lng], {
						radius: 5,
						color,
						fillColor: color,
						fillOpacity: 0.9,
						weight: 1
					}).addTo(state.map).bindTooltip(`${spot.barangay} | ${spot.disease}`);
					marker.on("click", () => {
						showHotspotAction(spot);
						toggleMapActionMode(true);
					});
					state.hotspotMarkers.push(marker);
				});
			}
			renderOverview();
			renderInsightPanel();
			renderMapPanel();
		});
	});

	document.getElementById("refreshSourcesBtn").addEventListener("click", () => {
		const time = new Date().toLocaleTimeString();
		document.getElementById("refreshSourcesBtn").textContent = `Refreshed ${time}`;
	});
}

function switchPanel(panelId) {
	document.querySelectorAll(".panel").forEach((panel) => panel.classList.remove("panel-active"));
	document.getElementById(panelId).classList.add("panel-active");

	if (panelId === "mapPanel") {
		if (!state.map) {
			initMap();
		} else {
			setTimeout(() => state.map.invalidateSize(), 20);
		}
	}
}

function renderOverview() {
	const kpiRoot = document.getElementById("kpiCards");
	kpiRoot.innerHTML = diseaseAnalyticsData.kpis
		.map((kpi) => `
			<article class="kpi-card">
				<h5>${kpi.label}</h5>
				<strong>${kpi.value}</strong>
				<small>${kpi.trend}</small>
			</article>
		`)
		.join("");

	const sourceRoot = document.getElementById("sourceList");
	sourceRoot.innerHTML = diseaseAnalyticsData.sources
		.map((source) => `<li><strong>${source.name}</strong><br><span>${source.status}</span></li>`)
		.join("");

	const prediction = diseaseAnalyticsData.predictionSummary;
	document.getElementById("predictionBanner").innerHTML = `
        <div class="prediction">
           <span>Predicted</span>
            <img src="/vet/images/shares.svg" alt="Prediction Icon" >
        </div>
		<strong>${prediction.total}</strong>
		<span>${prediction.label}</span>
	`;

	renderBarChart("actualChart", diseaseAnalyticsData.actualCases, "actual");
	renderBarChart("predictedChart", diseaseAnalyticsData.predictedCases, "predicted");

	const insightRoot = document.getElementById("insightCards");
	insightRoot.innerHTML = diseaseAnalyticsData.insights
		.map((insight) => `
			<article class="insight-card">
				<span class="chip">${insight.barangay}</span>
				<p>${insight.recommendation}</p>
				<button class="action-link" data-insight-id="${insight.id}">View Action</button>
			</article>
		`)
		.join("");

	insightRoot.querySelectorAll(".action-link").forEach((button) => {
		button.addEventListener("click", () => {
			state.selectedInsightId = button.dataset.insightId;
			renderInsightPanel();
			switchPanel("insightPanel");
		});
	});
}

function renderBarChart(targetId, rows, chartType) {
	const root = document.getElementById(targetId);
	root.classList.toggle("predicted", chartType === "predicted");
	const maxValue = Math.max(...rows.map((item) => item.value));

	root.innerHTML = rows
		.map((item) => {
			const width = Math.max((item.value / maxValue) * 100, 3);
			return `
				<div class="bar-row">
					<span>${item.barangay}</span>
					<div class="bar-track">
						<span class="bar-fill" style="width:${width}%;"></span>
					</div>
					<span>${item.value}</span>
				</div>
			`;
		})
		.join("");
}

function renderInsightPanel() {
	const insight = diseaseAnalyticsData.insights.find((row) => row.id === state.selectedInsightId) || diseaseAnalyticsData.insights[0];
	document.getElementById("insightBarangayName").textContent = insight.barangay;
	document.getElementById("selectedCaseCount").textContent = insight.cases;
	document.getElementById("selectedAverage").textContent = insight.avg;

	renderMiniBars("comparisonBars", insight.comparisons);
	renderMiniBars("predictionBars", insight.predicted);

	const protocol = insight.protocol;
	document.getElementById("protocolPanel").innerHTML = `
		<div class="protocol-alert">
			<div class="protocol-title">Auto-Triggered Protocol: ${insight.barangay}</div>
			<small>Classification: ${protocol.classification}</small>
		</div>
		<div class="protocol-id">
			<strong>${protocol.title}</strong>
			<p>${protocol.description}</p>
		</div>
		${protocol.steps
			.map(
				(step, index) => `
				<div class="action-step">
					<span class="step-dot ${step.level}">${String(index + 1).padStart(2, "0")}</span>
					<div>
						<strong>${step.title}</strong>
						<p>${step.detail}</p>
					</div>
				</div>
			`
			)
			.join("")}
		<div class="protocol-actions">
			<button class="btn btn-primary" id="createEventBtn">Create Event</button>
			<button class="btn btn-secondary" id="backOverviewBtn2">Back to Overview</button>
		</div>
	`;

	document.getElementById("createEventBtn").addEventListener("click", () => {
		alert(`Event created (frontend mock): ${insight.barangay} - ${insight.disease}`);
	});

	document.getElementById("backOverviewBtn2").addEventListener("click", () => switchPanel("overviewPanel"));
}

function renderMiniBars(targetId, rows) {
	const root = document.getElementById(targetId);
	root.innerHTML = rows
		.map(
			(item) => `
			<div class="bar-row">
				<span>${item.label}</span>
				<div class="bar-track">
					<span class="bar-fill" style="width:${item.value}%; background:${item.color};"></span>
				</div>
			</div>
		`
		)
		.join("");
}

function renderMapPanel() {
	const metricRoot = document.getElementById("mapMetricCards");
	metricRoot.innerHTML = diseaseAnalyticsData.map.metrics
		.map(
			(item) => `
			<article class="kpi-card">
				<h5>${item.label}</h5>
				<strong>${item.value}</strong>
				<small>${item.trend}</small>
			</article>
		`
		)
		.join("");

	renderHotspotList();

	const forecast = diseaseAnalyticsData.map.forecast;
	const max = Math.max(...forecast);
	const bars = forecast
		.map((value) => {
			const height = Math.max((value / max) * 100, 10);
			return `<span style="height:${height}%;"></span>`;
		})
		.join("");

	document.getElementById("forecastPanel").innerHTML = `
		<h4>Predicted Evolution</h4>
		<p>Next 14-day forecast</p>
		<div class="forecast-bars">${bars}</div>
	`;
}

function renderHotspotList() {
	const list = document.getElementById("hotspotList");
	list.innerHTML = diseaseAnalyticsData.map.hotspots
		.map(
			(hotspot) => `
			<article class="hotspot-item" data-hotspot-id="${hotspot.id}">
				<h4>${hotspot.barangay} <span class="risk-chip risk-${hotspot.risk}">${hotspot.risk.toUpperCase()}</span></h4>
				<p>${hotspot.disease}</p>
				<small>Cases ${hotspot.cases} | Predicted ${hotspot.predicted}</small>
			</article>
		`
		)
		.join("");

	list.querySelectorAll(".hotspot-item").forEach((item) => {
		item.addEventListener("click", () => {
			const hotspot = diseaseAnalyticsData.map.hotspots.find((row) => row.id === item.dataset.hotspotId);
			if (state.map && hotspot) {
				state.map.flyTo([hotspot.lat, hotspot.lng], 15, { duration: 0.65 });
				showHotspotAction(hotspot);
			}
		});
	});
}

function initMap() {
	const { center, zoom, hotspots } = diseaseAnalyticsData.map;
	state.map = L.map("baliwagMap", {
		zoomControl: false
	}).setView(center, zoom);

	L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
		attribution: "&copy; OpenStreetMap contributors"
	}).addTo(state.map);

	const heatPoints = hotspots.map((spot) => [spot.lat, spot.lng, spot.intensity]);
	state.heatLayer = L.heatLayer(heatPoints, {
		radius: 45,
		blur: 30,
		minOpacity: 0.5,
		gradient: {
			0.3: "#6ec7ff",
			0.55: "#fff27a",
			0.75: "#ff9248",
			1.0: "#e53030"
		}
	}).addTo(state.map);

	hotspots.forEach((spot) => {
		const color = getRiskColor(spot.risk);
		const marker = L.circleMarker([spot.lat, spot.lng], {
			radius: 5,
			color,
			fillColor: color,
			fillOpacity: 0.9,
			weight: 1
		})
			.addTo(state.map)
			.bindTooltip(`${spot.barangay} | ${spot.disease}`);

		marker.on("click", () => {
			showHotspotAction(spot);
			toggleMapActionMode(true);
		});

		state.hotspotMarkers.push(marker);
	});
}

function getRiskColor(risk) {
	if (risk === "critical") {
		return "#c31d1d";
	}
	if (risk === "monitor") {
		return "#a4851f";
	}
	return "#1e8a47";
}

function toggleMapActionMode(forceOn) {
	if (typeof forceOn === "boolean") {
		state.mapActionMode = forceOn;
	} else {
		state.mapActionMode = !state.mapActionMode;
	}

	const button = document.getElementById("toggleActionBtn");
	button.textContent = state.mapActionMode ? "Close Action Tab" : "Action Tab";

	if (!state.mapActionMode) {
		renderHotspotList();
		return;
	}

	const defaultHotspot = diseaseAnalyticsData.map.hotspots[0];
	showHotspotAction(defaultHotspot);
}

function showHotspotAction(hotspot) {
	const side = document.getElementById("hotspotList");
	side.innerHTML = `
		<section class="action-pane">
			<div class="protocol-alert">
				<div class="protocol-title">Auto-Triggered Protocol: ${hotspot.barangay}</div>
				<small>Classification: ${hotspot.risk === "critical" ? "Grade 4 Outbreak Risk" : "Grade 2 Monitoring"}</small>
			</div>
			<div class="protocol-id">
				<strong>Parvovirus Containment Protocol</strong>
				<p>Standardized biosafety level emergency response initiated via automated surveillance trigger.</p>
			</div>
			<div class="action-step">
				<span class="step-dot red">01</span>
				<div><strong>Immediate: Field Deployment</strong><p>Deploy Barangay Health Workers for door-to-door visual screening and pet registry verification.</p></div>
			</div>
			<div class="action-step">
				<span class="step-dot blue">02</span>
				<div><strong>Within 24hrs: Regulatory Reporting</strong><p>Mandatory escalation report to Municipal Health Office and Provincial Veterinary Services.</p></div>
			</div>
			<div class="action-step">
				<span class="step-dot green">03</span>
				<div><strong>Preventive: Sanitation Drive</strong><p>Conduct community sanitation sweep and distribute veterinary-grade disinfectants to high-risk households.</p></div>
			</div>
			<div class="action-step">
				<span class="step-dot gray">04</span>
				<div><strong>Monitoring: Case Reporting</strong><p>Daily case reporting for 14 days until incubation window clears and secondary screening is complete.</p></div>
			</div>
			<div class="protocol-actions">
				<button class="btn btn-primary" id="createMapEventBtn">Create Event</button>
				<button class="btn btn-secondary" id="backToMapOverviewBtn">Back to Overview</button>
			</div>
		</section>
	`;

	document.getElementById("createMapEventBtn").addEventListener("click", () => {
		alert(`Event created (frontend mock): ${hotspot.barangay} hotspot response`);
	});

	document.getElementById("backToMapOverviewBtn").addEventListener("click", () => {
		state.mapActionMode = false;
		document.getElementById("toggleActionBtn").textContent = "Action Tab";
		renderHotspotList();
	});
}

document.addEventListener("DOMContentLoaded", initDiseaseAnalytics);
