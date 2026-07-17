// Shared registry of vaccination types available across vet pages.
// The clinic currently only administers Anti-Rabies; other types can be
// registered on the fly via the "+ Add Type" buttons and are remembered
// (per browser) for future mass-vaccination events and patient visits.
(function () {
    const STORAGE_KEY = 'vbetter.vaccineTypes';
    const DEFAULT_TYPES = ['Anti-Rabies'];

    function loadCustom() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            const parsed = raw ? JSON.parse(raw) : [];
            return Array.isArray(parsed) ? parsed.filter((t) => typeof t === 'string' && t.trim()) : [];
        } catch (err) {
            return [];
        }
    }

    function saveCustom(types) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(types));
        } catch (err) {
            // localStorage unavailable — custom types just won't persist
        }
    }

    function getAll() {
        const custom = loadCustom().filter(
            (t) => !DEFAULT_TYPES.some((d) => d.toLowerCase() === t.toLowerCase())
        );
        return [...DEFAULT_TYPES, ...custom];
    }

    function add(name) {
        const trimmed = String(name || '').trim();
        if (!trimmed) return { ok: false, error: 'Please enter a vaccination type.' };
        const existing = getAll();
        if (existing.some((t) => t.toLowerCase() === trimmed.toLowerCase())) {
            return { ok: false, error: 'That vaccination type already exists.' };
        }
        const custom = loadCustom();
        custom.push(trimmed);
        saveCustom(custom);
        return { ok: true, value: trimmed };
    }

    window.VaccineTypes = { getAll, add, DEFAULT_TYPES };
})();
