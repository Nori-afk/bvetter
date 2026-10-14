<?php

use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/../../api/mass-vaccination/validation.php';

final class MassVaccinationValidationTest extends TestCase
{
    public function testEventIdentifiersCannotSilentlySelectAnotherRecord(): void
    {
        $this->assertSame(12, mv_event_id(['id' => 'evt-12']));
        foreach (['12junk', 'evt-12junk', 1.5, 0, null] as $id) {
            try {
                mv_event_id(['id' => $id]);
                $this->fail('Accepted an invalid event ID.');
            } catch (InvalidArgumentException $e) {
                $this->assertNotEmpty($e->getMessage());
            }
        }
    }
    public function testTotalsOnlyAndExplicitZeroReportsAreValid(): void
    {
        $this->assertSame(['total' => 100, 'dogs' => 0, 'cats' => 0, 'others' => 0], mv_report_counts(['totalVaccinated' => 100]));
        $this->assertSame(0, mv_report_counts(['totalVaccinated' => 0])['total']);
    }

    public function testInvalidTotalsCannotBecomeCompletedZeroReports(): void
    {
        foreach ([null, '', -1, 1.5, 'abc', '10pets', true, [], INF, 2147483648] as $value) {
            try {
                mv_report_counts(['totalVaccinated' => $value]);
                $this->fail('Accepted an invalid total: ' . var_export($value, true));
            } catch (InvalidArgumentException $e) {
                $this->assertStringContainsString('whole number', $e->getMessage());
            }
        }
    }

    public function testBreakdownMustMatchTotalAndContainValidCounts(): void
    {
        $valid = mv_report_counts(['totalVaccinated' => 100, 'breakdown' => ['dogs' => 70, 'cats' => 30]]);
        $this->assertSame(100, $valid['dogs'] + $valid['cats'] + $valid['others']);
        foreach ([['dogs' => 90], ['dogs' => -2, 'cats' => 102], ['dogs' => 99.5, 'cats' => 0.5], 'broken-json'] as $breakdown) {
            try {
                mv_report_counts(['totalVaccinated' => 100, 'breakdown' => $breakdown]);
                $this->fail('Accepted an invalid breakdown.');
            } catch (InvalidArgumentException $e) {
                $this->assertNotEmpty($e->getMessage());
            }
        }
    }

    public function testComparisonUsesOtherCompletedReportsForSameBarangayAndVaccine(): void
    {
        $event = ['id' => 1, 'event_date' => '2026-01-10', 'barangay' => 'Sto. Niño', 'vaccine' => 'Anti-Rabies', 'status' => 'Completed', 'total_vaccinated' => 999];
        $rows = [$event];
        $rows[] = array_replace($event, ['id' => 2, 'barangay' => 'Sto Nino', 'total_vaccinated' => 20]);
        $rows[] = array_replace($event, ['id' => 3, 'total_vaccinated' => 40]);
        $rows[] = array_replace($event, ['id' => 4, 'vaccine' => '5-in-1', 'total_vaccinated' => 500]);
        $rows[] = array_replace($event, ['id' => 5, 'status' => 'Pending Report', 'total_vaccinated' => null]);
        $rows[] = array_replace($event, ['id' => 6, 'barangay' => 'Tiaong', 'total_vaccinated' => 500]);
        $comparison = mv_event_comparison($event, $rows);
        $this->assertEquals(30, $comparison['average']);
        $this->assertSame(40, $comparison['highest']);
        $this->assertSame(2, $comparison['sampleCount']);
        $this->assertNull(mv_event_comparison($event, [$event])['average']);
    }
}
