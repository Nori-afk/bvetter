<?php
/**
 * BVetter – thin client for the Python analytics service.
 *
 * Used by write endpoints that need to tell the forecast its inputs changed.
 * The analytics service caches aggressively on purpose (CACHE_TTL is 6 hours,
 * and _barangay_vacc_cache has no expiry at all), which is right for the
 * expensive disease SARIMA searches but means a newly completed vaccination
 * event would otherwise sit invisible for hours.
 *
 * Deliberately separate from dashboard.php's analytics_post(): that one is a
 * request/response proxy with a 60-second timeout, appropriate for fetching a
 * forecast. This is fire-and-forget notification on a user's write path, so it
 * uses short timeouts and never lets a failure break the write.
 */

if (!function_exists('bv_analytics_urls')) {
    /** Same candidate list dashboard.php uses, kept in step deliberately. */
    function bv_analytics_urls(): array
    {
        $configured = trim((string) (getenv('VBETTER_ANALYTICS_URL') ?: ''));
        if ($configured !== '') {
            return [rtrim($configured, '/')];
        }
        // Loopback only. A hardcoded LAN address used to trail this list and,
        // off that one machine, was filtered rather than refused - so every
        // call waited out the full connect timeout reaching for it. See the
        // matching note on analytics_service_urls() in dashboard.php.
        return ['http://127.0.0.1:5001', 'http://localhost:5001'];
    }
}

if (!function_exists('bv_analytics_invalidate_vaccination')) {
    /**
     * Tells the analytics service to drop its cached vaccination forecasts.
     *
     * Call this when an event BECOMES Completed, or when an already-Completed
     * event is edited or deleted. Do NOT call it when an event is created --
     * new events are 'Pending Report' and are excluded from the forecast, so
     * there is nothing to recompute.
     *
     * This asks for a recalculation; it does not make live data eligible. The
     * plausibility gate in load_vaccination_series() still decides whether the
     * DB months reach the fit.
     *
     * Idempotent per request via a static flag, so a handler that touches two
     * rows still issues one call. Never throws and never blocks the write: if
     * the service is unreachable the change is simply picked up when the
     * existing TTL expires.
     *
     * @return bool true if a service acknowledged the invalidation
     */
    function bv_analytics_invalidate_vaccination(): bool
    {
        static $alreadyInvalidated = false;
        if ($alreadyInvalidated) {
            return true;
        }
        $alreadyInvalidated = true;

        foreach (bv_analytics_urls() as $baseUrl) {
            $ch = curl_init($baseUrl . '/invalidate-vaccination-cache');
            curl_setopt($ch, CURLOPT_POST, true);
            curl_setopt($ch, CURLOPT_POSTFIELDS, '{}');
            curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json']);
            curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
            // Sub-second, because this sits on a vet's save action rather than in
            // a background job. CURLOPT_CONNECTTIMEOUT has a 1-second floor, and
            // three candidate URLs at that floor cost ~2.8s on a save when the
            // service is down (measured) -- almost all of it the LAN candidate,
            // which is filtered rather than refused and so waits out the timeout.
            // The _MS variants cap the whole sweep at roughly a second.
            curl_setopt($ch, CURLOPT_CONNECTTIMEOUT_MS, 400);
            curl_setopt($ch, CURLOPT_TIMEOUT_MS, 1500);

            curl_exec($ch);
            $ok     = curl_errno($ch) === 0;
            $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
            curl_close($ch);

            if ($ok && $status >= 200 && $status < 300) {
                return true;
            }
        }

        error_log('[BVetter] vaccination forecast cache not invalidated: analytics service '
                . 'unreachable. The change will be picked up when the cache expires.');
        return false;
    }
}

if (!function_exists('bv_analytics_invalidate_disease')) {
    /**
     * Tells the analytics service a new consultation dataset version is active.
     *
     * IMPORTANT — this is an optimisation, not the correctness mechanism.
     * Unlike the vaccination caches, two of the three disease caches
     * (_all_disease_models and _consult_diagnosis_df) have NO expiry at all, so
     * if this call were the only signal and the service happened to be
     * unreachable, an upload would report success while the dashboard served
     * the old dataset until somebody restarted the service by hand.
     *
     * So arima_service.py independently compares the active dataset_versions.id
     * against the one it built from, and rebuilds when they differ. That check
     * is what guarantees freshness. This call only makes the rebuild start now
     * instead of on the next request, and returning false is not an error.
     *
     * Timeouts are longer than the vaccination sibling's: that one sits on a
     * vet's save button, this one sits on a file upload that already took
     * seconds, so waiting a moment for a clean acknowledgement is free.
     *
     * @return bool true if a service acknowledged the invalidation
     */
    function bv_analytics_invalidate_disease(): bool
    {
        foreach (bv_analytics_urls() as $baseUrl) {
            $ch = curl_init($baseUrl . '/invalidate-disease-cache');
            curl_setopt($ch, CURLOPT_POST, true);
            curl_setopt($ch, CURLOPT_POSTFIELDS, '{}');
            curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json']);
            curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
            curl_setopt($ch, CURLOPT_CONNECTTIMEOUT_MS, 800);
            curl_setopt($ch, CURLOPT_TIMEOUT_MS, 4000);

            curl_exec($ch);
            $ok     = curl_errno($ch) === 0;
            $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
            curl_close($ch);

            if ($ok && $status >= 200 && $status < 300) {
                return true;
            }
        }

        error_log('[BVetter] disease cache not invalidated: analytics service unreachable. '
                . 'The new dataset version will be picked up by the version check on next use.');
        return false;
    }
}
