<?php
/**
 * BVetter – Chatbot input normalization
 *
 * Pure functions only (no I/O, no DB, no headers) — extracted from
 * chatbot.php so the consultation-input normalization can be unit-tested
 * directly (see tests/php/ChatbotNormalizeTest.php) without booting the
 * whole endpoint (which requires a POST request and a DB connection).
 */

if (!function_exists('clean')) {
    // parang kapang wala pang function na clean doon palang gagawa, for verification
    function clean($value)
    {
        return trim((string) $value);
    }
}

function normalizeStatus($value)
{
    // for checking the if the status of the value is among the list, if not or di siya inactive then we will set it as active
    return strtolower(clean($value)) === 'inactive' ? 'inactive' : 'active';
}

function normalizeDuration($value)
{
    //used str pos to find the first occurance of substring 
    $value = strtolower(clean($value));
    if ($value === '<24h' || strpos($value, 'less') !== false) return 'Less Than 24 Hours';
    if (strpos($value, 'more') !== false || strpos($value, '>3') !== false) return 'More than 3 days';
    return '1-3 Days';
}

function normalizePetType($value)
{
    $value = strtolower(clean($value));
    if (strpos($value, 'cat') === 0) return 'Cat';
    if (strpos($value, 'dog') === 0) return 'Dog';
    return 'Other';
}

function normalizeSeverity($value)
{
    $value = strtolower(clean($value));
    if (strpos($value, 'not moving') !== false || strpos($value, 'critical') !== false || strpos($value, 'emergency') !== false) return 'Critical';
    if (strpos($value, 'weak') !== false || strpos($value, 'moderate') !== false) return 'Moderate';
    return 'Active';
}

function decodeSymptoms($value)
{
    if (is_array($value)) {
        return array_values(array_filter(array_map('clean', $value)));
    }

    $value = clean($value);
    if ($value === '') return [];

    $decoded = json_decode($value, true);
    if (is_array($decoded)) {
        return array_values(array_filter(array_map('clean', $decoded)));
    }

    return array_values(array_filter(array_map('clean', explode(',', $value))));
}
