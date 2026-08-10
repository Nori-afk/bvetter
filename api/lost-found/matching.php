<?php
/**
 * BVetter – Lost & Found matching primitives
 *
 * Pure functions only (no I/O, no DB, no headers) — extracted from
 * lost_and_found.php so the Jaccard/scoring logic can be unit-tested
 * directly (see tests/php/LostFoundMatchingTest.php) without booting the
 * whole endpoint (which requires a POST request and a DB connection).
 */

if (!function_exists('clean')) {
    function clean($value)
    {
        return trim((string) $value);
    }
}

function tokenSet($text)
{
    $text = strtolower((string) $text);
    $text = preg_replace('/[^a-z0-9]+/', ' ', $text);
    $parts = preg_split('/\s+/', trim($text));
    $tokens = [];
    foreach ($parts as $part) {
        if (strlen($part) >= 2) $tokens[$part] = true;
    }
    return array_keys($tokens);
}

function jaccard($a, $b)
{
    $a = tokenSet($a);
    $b = tokenSet($b);
    if (!$a || !$b) return 0.0;
    $setA = array_fill_keys($a, true);
    $setB = array_fill_keys($b, true);
    $intersection = count(array_intersect_key($setA, $setB));
    $union = count($setA + $setB);
    return $union > 0 ? $intersection / $union : 0.0;
}

function hammingSimilarity($a, $b)
{
    if (!$a || !$b || strlen($a) !== strlen($b)) return null;
    $diff = 0;
    $len = strlen($a);
    for ($i = 0; $i < $len; $i++) {
        if ($a[$i] !== $b[$i]) $diff++;
    }
    return 1.0 - ($diff / $len);
}

function rgbSimilarity($a, $b)
{
    if (!is_array($a) || !is_array($b) || count($a) < 3 || count($b) < 3) return null;
    $distance = sqrt(pow($a[0] - $b[0], 2) + pow($a[1] - $b[1], 2) + pow($a[2] - $b[2], 2));
    return max(0.0, 1.0 - ($distance / 441.68));
}

function distanceKm($lat1, $lng1, $lat2, $lng2)
{
    if ($lat1 === null || $lng1 === null || $lat2 === null || $lng2 === null) return null;
    $earth = 6371;
    $dLat = deg2rad((float) $lat2 - (float) $lat1);
    $dLng = deg2rad((float) $lng2 - (float) $lng1);
    $a = sin($dLat / 2) * sin($dLat / 2) + cos(deg2rad((float) $lat1)) * cos(deg2rad((float) $lat2)) * sin($dLng / 2) * sin($dLng / 2);
    return $earth * (2 * atan2(sqrt($a), sqrt(1 - $a)));
}

function scoreMatch($lost, $candidate)
{
    $score = 0;
    $reasons = [];
    $lostSpecies = strtolower(clean($lost['species'] ?? ''));
    $candidateSpecies = strtolower(clean($candidate['species'] ?? ''));

    if ($lostSpecies !== '' && $candidateSpecies !== '' && $lostSpecies !== $candidateSpecies) {
        return [0, ['Different species']];
    }

    if ($lostSpecies !== '' && $candidateSpecies !== '' && $lostSpecies === $candidateSpecies) {
        $score += 12;
        $reasons[] = 'Same species';
    }

    $breed = jaccard($lost['breed'], $candidate['breed']);
    if ($breed >= 0.5) $reasons[] = 'Similar breed';
    $score += (int) round($breed * 14);

    if (clean($lost['sex']) !== '' && clean($candidate['sex']) !== '' && strtolower($lost['sex']) === strtolower($candidate['sex'])) {
        $score += 8;
        $reasons[] = 'Same sex';
    }

    if (clean($lost['size']) !== '' && clean($candidate['size']) !== '' && strtolower($lost['size']) === strtolower($candidate['size'])) {
        $score += 10;
        $reasons[] = 'Same size';
    }

    $markings = jaccard($lost['color_markings'] . ' ' . $lost['notes'], $candidate['color_markings'] . ' ' . $candidate['notes']);
    if ($markings >= 0.25) $reasons[] = 'Similar color or markings';
    $score += (int) round($markings * 18);

    if ($lost['barangay_id'] && $candidate['barangay_id'] && (int) $lost['barangay_id'] === (int) $candidate['barangay_id']) {
        $score += 18;
        $reasons[] = 'Same barangay';
    } else {
        $distance = distanceKm($lost['latitude'], $lost['longitude'], $candidate['latitude'], $candidate['longitude']);
        if ($distance !== null) {
            if ($distance <= 1) {
                $score += 18;
                $reasons[] = 'Within 1 km';
            } elseif ($distance <= 3) {
                $score += 12;
                $reasons[] = 'Nearby location';
            } elseif ($distance <= 7) {
                $score += 6;
                $reasons[] = 'Same city area';
            }
        }
    }

    $lostFeatures = json_decode((string) $lost['image_features'], true);
    $candidateFeatures = json_decode((string) $candidate['image_features'], true);
    if (is_array($lostFeatures) && is_array($candidateFeatures)) {
        $rgb = rgbSimilarity($lostFeatures['avg_rgb'] ?? null, $candidateFeatures['avg_rgb'] ?? null);
        if ($rgb !== null) {
            if ($rgb >= 0.78) $reasons[] = 'Similar photo color profile';
            $score += (int) round($rgb * 10);
        }

        $hash = hammingSimilarity($lostFeatures['brightness_hash'] ?? null, $candidateFeatures['brightness_hash'] ?? null);
        if ($hash !== null) {
            if ($hash >= 0.68) $reasons[] = 'Similar image pattern';
            $score += (int) round($hash * 10);
        } elseif (($lostFeatures['width'] ?? 0) && ($candidateFeatures['width'] ?? 0)) {
            $ratioA = ((float) $lostFeatures['width']) / max(1, (float) $lostFeatures['height']);
            $ratioB = ((float) $candidateFeatures['width']) / max(1, (float) $candidateFeatures['height']);
            $ratioScore = max(0, 1 - min(1, abs($ratioA - $ratioB)));
            $score += (int) round($ratioScore * 4);
        }
    }

    $score = min(100, max(0, $score));
    if (!$reasons) $reasons[] = 'Low-confidence candidate';

    return [$score, array_values(array_unique($reasons))];
}
