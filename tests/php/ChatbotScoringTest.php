<?php

use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/../../api/chatbot/scoring.php';

/**
 * Locks down the chatbot consultation matcher (scoreRule) used by the
 * symptom-checker flow.
 *
 * This is the counterpart to LostFoundMatchingTest, and the contrast is the
 * point: Lost & Found matches with Jaccard similarity (normalized by set
 * union, bounded 0..1), while the chatbot accumulates fixed weights and
 * never divides. Both are "similarity matching" in the write-up; only one
 * of them is Jaccard. These tests pin the actual arithmetic so that claim
 * can be made accurately.
 */
final class ChatbotScoringTest extends TestCase
{
    /** Mirrors the shape of a chatbot_consultation_rules row. */
    private function rule(string $petType, array $symptoms, string $duration, string $severity): array
    {
        return [
            'pet_type' => $petType,
            'symptoms_json' => json_encode($symptoms),
            'duration' => $duration,
            'severity' => $severity,
        ];
    }

    public function testExactMatchOnEveryFacetScoresAllWeights(): void
    {
        // 2 (pet type) + 2 (duration) + 2 (severity) + 3 (one symptom) = 9
        $rule = $this->rule('Dog', ['Vomiting'], 'Less Than 24 Hours', 'Active');
        $this->assertSame(9, scoreRule($rule, 'Dog', ['Vomiting'], 'Less Than 24 Hours', 'Active'));
    }

    public function testNothingInCommonScoresZero(): void
    {
        $rule = $this->rule('Dog', ['Vomiting'], 'Less Than 24 Hours', 'Active');
        $this->assertSame(0, scoreRule($rule, 'Cat', ['Wounds'], 'More than 3 days', 'Critical'));
    }

    public function testEachOverlappingSymptomAddsThree(): void
    {
        $rule = $this->rule('Dog', ['Vomiting', 'Diarrhea', 'Wounds'], 'Less Than 24 Hours', 'Active');

        // Same rule, same facets, differing only in how many symptoms overlap.
        $one = scoreRule($rule, 'Cat', ['Vomiting'], 'More than 3 days', 'Critical');
        $two = scoreRule($rule, 'Cat', ['Vomiting', 'Diarrhea'], 'More than 3 days', 'Critical');
        $three = scoreRule($rule, 'Cat', ['Vomiting', 'Diarrhea', 'Wounds'], 'More than 3 days', 'Critical');

        $this->assertSame(3, $one);
        $this->assertSame(6, $two);
        $this->assertSame(9, $three);
    }

    public function testScoreIsNotNormalizedBySymptomCount(): void
    {
        // The defining difference from Jaccard. A rule listing one symptom,
        // queried with that symptom plus nine unrelated ones, still scores the
        // full +3 -- the nine misses cost nothing. Under Jaccard the same pair
        // would be 1/10 = 0.1. Symptom breadth therefore cannot dilute a rule,
        // and a long symptom list can only ever push the score up.
        $rule = $this->rule('Dog', ['Vomiting'], 'Less Than 24 Hours', 'Active');
        $noise = ['Vomiting', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'];

        $this->assertSame(3, scoreRule($rule, 'Cat', ['Vomiting'], 'More than 3 days', 'Critical'));
        $this->assertSame(3, scoreRule($rule, 'Cat', $noise, 'More than 3 days', 'Critical'));
    }

    public function testOtherPetTypeActsAsWildcardWhenSymptomsOverlap(): void
    {
        // A rule saved as pet_type 'Other' scores its +2 against every species,
        // not just pets whose type is literally "Other" -- but the wildcard is
        // no exception to the overlap guard below: it only fires once there is
        // a real symptom in common.
        $rule = $this->rule('Other', ['Vomiting'], 'Less Than 24 Hours', 'Active');

        foreach (['Dog', 'Cat', 'Other'] as $petType) {
            $this->assertSame(
                5, // 2 (Other wildcard) + 3 (one overlapping symptom)
                scoreRule($rule, $petType, ['Vomiting'], 'More than 3 days', 'Critical'),
                "pet_type 'Other' should match {$petType} once symptoms overlap"
            );
        }
    }

    public function testOtherPetTypeWildcardStillRequiresSymptomOverlap(): void
    {
        // Same rule and pet types as above, but the reported symptom (Wounds)
        // is not one the rule lists (Vomiting) -- the wildcard does not exempt
        // this rule from the guard, so it must still be rejected.
        $rule = $this->rule('Other', ['Vomiting'], 'Less Than 24 Hours', 'Active');

        foreach (['Dog', 'Cat', 'Other'] as $petType) {
            $this->assertSame(
                0,
                scoreRule($rule, $petType, ['Wounds'], 'More than 3 days', 'Critical'),
                "pet_type 'Other' should not match {$petType} without a shared symptom"
            );
        }
    }

    public function testSymptomComparisonIsCaseSensitive(): void
    {
        // in_array(..., true) is strict, so casing must match the stored rule
        // exactly. The UI sends names straight from chatbot_symptoms so this
        // holds in practice, but any free-text or re-cased input silently
        // scores zero for that symptom rather than matching.
        $rule = $this->rule('Dog', ['Vomiting'], 'Less Than 24 Hours', 'Active');

        $this->assertSame(3, scoreRule($rule, 'Cat', ['Vomiting'], 'More than 3 days', 'Critical'));
        $this->assertSame(0, scoreRule($rule, 'Cat', ['vomiting'], 'More than 3 days', 'Critical'));
    }

    public function testFacetOnlyMatchNoLongerReachesTheCutoff(): void
    {
        // Regression pin for the fixed bug: before the overlap guard, pet
        // type + duration alone (+2 +2) reached the >= 4 cutoff with zero
        // symptoms shared, so this rule won even though the owner never
        // reported Seizures. The guard now rejects it outright.
        $rule = $this->rule('Dog', ['Seizures'], 'Less Than 24 Hours', 'Critical');
        $score = scoreRule($rule, 'Dog', ['Loss of Appetite'], 'Less Than 24 Hours', 'Active');

        $this->assertSame(0, $score);
        $this->assertLessThan(4, $score);
    }

    public function testSingleFacetMatchIsRejected(): void
    {
        $rule = $this->rule('Dog', ['Seizures'], 'Less Than 24 Hours', 'Critical');
        $score = scoreRule($rule, 'Dog', ['Loss of Appetite'], 'More than 3 days', 'Active');

        $this->assertSame(0, $score);
        $this->assertLessThan(4, $score);
    }

    /**
     * (A) The exact case the verification report used as a valid baseline:
     * Dog + Vomiting/Diarrhea + <24h + Active against the seeded rule 1
     * shape. A real overlap still lets the rule win at its old score.
     */
    public function testValidMatchStillWorksAfterTheGuard(): void
    {
        $rule = $this->rule('Dog', ['Vomiting', 'Diarrhea'], 'Less Than 24 Hours', 'Active');
        $score = scoreRule($rule, 'Dog', ['Vomiting', 'Diarrhea'], 'Less Than 24 Hours', 'Active');

        $this->assertSame(12, $score); // 2 + 2 + 2 + 3*2
        $this->assertGreaterThanOrEqual(4, $score);
    }

    /**
     * (B) The bug's own reproduction case: Cat + Coughing against a Dog
     * vomiting/diarrhea rule used to score 4 (duration +2, severity +2)
     * and win. Coughing shares nothing with the rule's symptom list, so
     * the guard must reject it regardless of the facet total.
     */
    public function testBlindMatchOnDurationAndSeverityIsRejected(): void
    {
        $rule = $this->rule('Dog', ['Vomiting', 'Diarrhea'], 'Less Than 24 Hours', 'Active');
        $score = scoreRule($rule, 'Cat', ['Coughing'], 'Less Than 24 Hours', 'Active');

        $this->assertSame(0, $score);
        $this->assertLessThan(4, $score);
    }

    /**
     * (C) Dog + Coughing + <24h + Critical against the seizure rule: every
     * facet matches (pet type, duration, severity = +2+2+2 = 6), which
     * would have cleared the cutoff comfortably under the old scoring.
     * Coughing is not Seizures, so this must still be rejected -- a high
     * facet score cannot substitute for symptom evidence, even for an
     * emergency-tier rule.
     */
    public function testCriticalBlindMatchIsRejectedDespiteAllFacetsMatching(): void
    {
        $rule = $this->rule('Dog', ['Seizures'], 'Less Than 24 Hours', 'Critical');
        $score = scoreRule($rule, 'Dog', ['Coughing'], 'Less Than 24 Hours', 'Critical');

        $this->assertSame(0, $score);
    }

    /**
     * (E) Multiple reported symptoms where only one overlaps the rule: the
     * rule must still be eligible (guard passes on >= 1 shared symptom),
     * and only the overlapping symptom contributes +3 -- the non-matching
     * one costs nothing, exactly as before the guard.
     */
    public function testRuleIsEligibleWhenAtLeastOneOfSeveralSymptomsOverlaps(): void
    {
        $rule = $this->rule('Dog', ['Vomiting'], 'Less Than 24 Hours', 'Active');
        $score = scoreRule($rule, 'Dog', ['Vomiting', 'Fever'], 'Less Than 24 Hours', 'Active');

        $this->assertSame(9, $score); // 2 + 2 + 2 + 3*1 -- Fever adds nothing, doesn't block
    }

    public function testDistinctRulesCanTieOnScore(): void
    {
        // assessConsultation() picks with `$score > $bestScore`, so on a tie
        // the rule fetched first wins and the other is never considered.
        // Exact ties between genuinely different rules are reachable, which
        // means SELECT order alone can decide the recommendation shown to the
        // owner. Note the second rule here is for a *Cat* and still ties on a
        // Dog consultation, because matching the two facets is worth as much
        // as matching the species plus the duration.
        $dogRule = $this->rule('Dog', ['Vomiting'], 'Less Than 24 Hours', 'Critical');
        $catRule = $this->rule('Cat', ['Diarrhea'], 'Less Than 24 Hours', 'Active');

        $dogScore = scoreRule($dogRule, 'Dog', ['Vomiting', 'Diarrhea'], 'Less Than 24 Hours', 'Active');
        $catScore = scoreRule($catRule, 'Dog', ['Vomiting', 'Diarrhea'], 'Less Than 24 Hours', 'Active');

        $this->assertSame(7, $dogScore);
        $this->assertSame(7, $catScore);
        $this->assertSame($dogScore, $catScore);
    }

    public function testSymptomsJsonAcceptsNonJsonStorageFormats(): void
    {
        // decodeSymptoms() tolerates a comma-separated column value, so rules
        // written before the JSON format still score.
        $rule = [
            'pet_type' => 'Dog',
            'symptoms_json' => 'Vomiting, Diarrhea',
            'duration' => 'Less Than 24 Hours',
            'severity' => 'Active',
        ];

        $this->assertSame(6, scoreRule($rule, 'Cat', ['Vomiting', 'Diarrhea'], 'More than 3 days', 'Critical'));
    }

    public function testActionLevelMapsEachActionType(): void
    {
        $this->assertSame('high', actionLevel('emergency_visit'));
        $this->assertSame('moderate', actionLevel('book_appointment'));
        $this->assertSame('low', actionLevel('monitor_24hrs'));
        $this->assertSame('low', actionLevel('home_care'));
        $this->assertSame('low', actionLevel('anything_unrecognized'));
    }
}
