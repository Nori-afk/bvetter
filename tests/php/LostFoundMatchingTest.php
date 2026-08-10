<?php

use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/../../api/lost-found/matching.php';

/**
 * Locks down the Jaccard-similarity matching used by the Lost & Found
 * "Potential Matches" feature (TC-F09) — this is the one piece of the
 * matching pipeline the thesis specifically claims is Jaccard-based, so a
 * regression here would be a real, defense-relevant gap.
 */
final class LostFoundMatchingTest extends TestCase
{
    public function testJaccardOfIdenticalStringsIsOne(): void
    {
        // intersection/union both come out to int 2/2 here — PHP's `/`
        // returns int, not float, when evenly divisible, so compare
        // numerically rather than with assertSame's strict type check.
        $this->assertEqualsWithDelta(1.0, jaccard('brown labrador', 'brown labrador'), 0.0001);
    }

    public function testJaccardOfCompletelyDifferentStringsIsZero(): void
    {
        $this->assertEqualsWithDelta(0.0, jaccard('brown labrador', 'black cat'), 0.0001);
    }

    public function testJaccardIsPartialOverlapRatio(): void
    {
        // {brown, labrador, medium} vs {brown, labrador, large}
        // intersection = 2 (brown, labrador), union = 4 => 0.5
        $this->assertSame(0.5, jaccard('brown labrador medium', 'brown labrador large'));
    }

    public function testJaccardIsSymmetric(): void
    {
        $a = 'white spots on chest and paws';
        $b = 'white paws with a spot on chest';
        $this->assertSame(jaccard($a, $b), jaccard($b, $a));
    }

    public function testJaccardOfEmptyOrWhitespaceInputIsZero(): void
    {
        $this->assertSame(0.0, jaccard('', 'brown labrador'));
        $this->assertSame(0.0, jaccard('   ', 'brown labrador'));
        $this->assertSame(0.0, jaccard('', ''));
    }

    public function testTokenSetIsCaseInsensitiveAndDropsSingleCharTokens(): void
    {
        // "a" (1 char) is dropped; punctuation is treated as a separator.
        $this->assertEqualsCanonicalizing(
            ['brown', 'dog', 'with', 'tag'],
            tokenSet('A Brown, Dog — with-tag!')
        );
    }

    public function testScoreMatchRejectsDifferentSpeciesRegardlessOfOtherAttributes(): void
    {
        $lost = $this->pet(['species' => 'Dog', 'breed' => 'Labrador', 'color_markings' => 'brown', 'notes' => '']);
        $candidate = $this->pet(['species' => 'Cat', 'breed' => 'Labrador', 'color_markings' => 'brown', 'notes' => '']);

        [$score, $reasons] = scoreMatch($lost, $candidate);

        $this->assertSame(0, $score);
        $this->assertSame(['Different species'], $reasons);
    }

    public function testScoreMatchRewardsSameSpeciesBreedSizeAndBarangay(): void
    {
        $lost = $this->pet([
            'species' => 'Dog', 'breed' => 'Aspin', 'sex' => 'Male', 'size' => 'Medium',
            'color_markings' => 'brown with white chest', 'notes' => 'friendly',
            'barangay_id' => 5,
        ]);
        $candidate = $this->pet([
            'species' => 'Dog', 'breed' => 'Aspin', 'sex' => 'Male', 'size' => 'Medium',
            'color_markings' => 'brown with white chest', 'notes' => 'friendly',
            'barangay_id' => 5,
        ]);

        [$score, $reasons] = scoreMatch($lost, $candidate);

        $this->assertGreaterThan(50, $score);
        $this->assertContains('Same species', $reasons);
        $this->assertContains('Same barangay', $reasons);
    }

    public function testScoreMatchFallsBackToLowConfidenceReasonWhenNothingMatches(): void
    {
        $lost = $this->pet(['species' => '', 'breed' => '', 'color_markings' => '', 'notes' => '', 'barangay_id' => null]);
        $candidate = $this->pet(['species' => '', 'breed' => '', 'color_markings' => '', 'notes' => '', 'barangay_id' => null]);

        [$score, $reasons] = scoreMatch($lost, $candidate);

        $this->assertSame(0, $score);
        $this->assertSame(['Low-confidence candidate'], $reasons);
    }

    private function pet(array $overrides): array
    {
        return array_merge([
            'species' => 'Dog', 'breed' => '', 'sex' => '', 'size' => '',
            'color_markings' => '', 'notes' => '', 'barangay_id' => null,
            'latitude' => null, 'longitude' => null, 'image_features' => null,
        ], $overrides);
    }
}
