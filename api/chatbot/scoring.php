<?php
/**
 * BVetter – Chatbot consultation rule scoring
 *
 * Pure functions only (no I/O, no DB, no headers) — extracted from
 * chatbot.php so the symptom-matching score can be unit-tested directly
 * (see tests/php/ChatbotScoringTest.php) without booting the whole
 * endpoint (which requires a POST request and a DB connection).
 *
 * Note: this is deliberately NOT Jaccard similarity. The Lost & Found
 * matcher (api/lost-found/matching.php) normalizes by set union; this one
 * accumulates fixed weights and never divides, so the score is unbounded
 * in the symptom count. assessConsultation() compares it against a flat
 * >= 4 cutoff before falling back to fallbackAssessment().
 *
 * Symptom-overlap guard: pet type (+2), duration (+2), and severity (+2)
 * alone reach that >= 4 cutoff with zero symptoms in common, so a rule
 * used to be selectable on facets it happens to share by chance, with no
 * evidence for the condition it names (verification report, 2026-08-24:
 * 23/27 swept combinations blind-matched this way). A rule with at least
 * one symptom in the request is presumed selectable; anything else is
 * rejected before the facet weights are ever added, regardless of how
 * high they'd otherwise push the score.
 */

require_once __DIR__ . '/normalize.php';

function scoreRule($rule, $petType, $symptoms, $duration, $severity)
{
    $ruleSymptoms = decodeSymptoms($rule['symptoms_json']);
    $overlap = array_intersect($symptoms, $ruleSymptoms);
    if (!$overlap) return 0;

    $score = 0;
    if ($rule['pet_type'] === $petType || $rule['pet_type'] === 'Other') $score += 2;
    if ($rule['duration'] === $duration) $score += 2;
    if ($rule['severity'] === $severity) $score += 2;
    $score += 3 * count($overlap);

    return $score;
}

function actionLevel($actionType)
{
    if ($actionType === 'emergency_visit') return 'high';
    if ($actionType === 'book_appointment') return 'moderate';
    return 'low';
}
