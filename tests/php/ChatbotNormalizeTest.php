<?php

use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/../../api/chatbot/normalize.php';

/**
 * Covers the input-normalization rules that decide which consultation rule
 * a chatbot submission matches (TC-F10) — free-text-ish input (duration,
 * severity phrasing) gets mapped onto the fixed set of values the rules
 * table is keyed on.
 */
final class ChatbotNormalizeTest extends TestCase
{
    public function testNormalizeDurationRecognizesLessThan24Hours(): void
    {
        $this->assertSame('Less Than 24 Hours', normalizeDuration('<24h'));
        $this->assertSame('Less Than 24 Hours', normalizeDuration('Less than a day'));
    }

    public function testNormalizeDurationRecognizesMoreThanThreeDays(): void
    {
        $this->assertSame('More than 3 days', normalizeDuration('more than 3 days'));
        $this->assertSame('More than 3 days', normalizeDuration('>3days'));
    }

    public function testNormalizeDurationDefaultsToOneToThreeDays(): void
    {
        $this->assertSame('1-3 Days', normalizeDuration('2 days'));
        $this->assertSame('1-3 Days', normalizeDuration(''));
    }

    public function testNormalizePetTypeMatchesOnPrefix(): void
    {
        $this->assertSame('Cat', normalizePetType('cat'));
        $this->assertSame('Cat', normalizePetType('Catherine the cat')); // starts with "cat"
        $this->assertSame('Dog', normalizePetType('dog'));
        $this->assertSame('Other', normalizePetType('rabbit'));
    }

    public function testNormalizeSeverityFlagsCriticalKeywords(): void
    {
        $this->assertSame('Critical', normalizeSeverity('not moving at all'));
        $this->assertSame('Critical', normalizeSeverity('This is an emergency'));
    }

    public function testNormalizeSeverityFlagsModerateKeywords(): void
    {
        $this->assertSame('Moderate', normalizeSeverity('looks weak'));
    }

    public function testNormalizeSeverityDefaultsToActive(): void
    {
        $this->assertSame('Active', normalizeSeverity('playful and eating normally'));
    }

    public function testDecodeSymptomsFromArray(): void
    {
        $this->assertSame(
            ['vomiting', 'lethargy'],
            decodeSymptoms(['vomiting', ' lethargy ', ''])
        );
    }

    public function testDecodeSymptomsFromJsonString(): void
    {
        $this->assertSame(
            ['vomiting', 'lethargy'],
            decodeSymptoms('["vomiting","lethargy"]')
        );
    }

    public function testDecodeSymptomsFromCommaSeparatedString(): void
    {
        $this->assertSame(
            ['vomiting', 'lethargy'],
            decodeSymptoms('vomiting, lethargy')
        );
    }

    public function testDecodeSymptomsFromEmptyValueIsEmptyArray(): void
    {
        $this->assertSame([], decodeSymptoms(''));
        $this->assertSame([], decodeSymptoms(null));
    }
}
