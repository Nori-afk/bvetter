<?php

use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/../../api/includes/booking_pets.php';

final class BookingPetsTest extends TestCase
{
    private function pet(string $name = 'Luna'): array
    {
        return ['pet_name' => $name, 'pet_type' => 'Dog', 'pet_breed' => 'Aspin', 'pet_sex' => 'Female', 'pet_age' => '2 Years'];
    }

    public function testLegacySinglePetAndMultiplePetsRetainTheirDetails(): void
    {
        $first = $this->pet();
        $second = array_replace($this->pet('Milo'), ['pet_type' => 'Cat', 'pet_age' => '6 Months']);
        $this->assertSame([$first], bookingPetEntries($first));
        $this->assertSame([$first, $second], bookingPetEntries(['pets' => [$first, $second]]));
    }

    public function testAnInvalidSecondPetRejectsTheWholeRequest(): void
    {
        $this->expectException(InvalidArgumentException::class);
        $this->expectExceptionMessage('Pet 2');
        bookingPetEntries(['pets' => [$this->pet(), array_replace($this->pet('Milo'), ['pet_breed' => ''])]]);
    }

    public function testEmptyOrMalformedPetListsCannotFallBackToTheFirstPet(): void
    {
        foreach ([[], null, 'Luna', ['name' => 'Luna'], [$this->pet(), 'Milo']] as $pets) {
            try {
                bookingPetEntries(array_merge($this->pet(), ['pets' => $pets]));
                $this->fail('Accepted a malformed pet list.');
            } catch (InvalidArgumentException $e) {
                $this->assertNotEmpty($e->getMessage());
            }
        }
    }

    public function testDuplicatePetsAreRejectedByNameOrId(): void
    {
        foreach ([[$this->pet('Luna'), $this->pet(' luna ')], [['pet_id' => 7], ['pet_id' => '7']]] as $pets) {
            try {
                bookingPetEntries(['pets' => $pets]);
                $this->fail('Accepted the same pet twice.');
            } catch (InvalidArgumentException $e) {
                $this->assertStringContainsString('already included', $e->getMessage());
            }
        }
    }

    public function testAgeIsOptionalForVisitsAndRequiredForEveryProgramPet(): void
    {
        $unknownAge = array_replace($this->pet('Milo'), ['pet_age' => '']);
        $this->assertCount(2, bookingPetEntries(['pets' => [$this->pet(), $unknownAge]]));
        $this->expectException(InvalidArgumentException::class);
        $this->expectExceptionMessage('Pet 2: Age is required');
        bookingPetEntries(['pets' => [$this->pet(), $unknownAge]], true);
    }

    public function testInvalidDetailsOnAdditionalPetsAreRejected(): void
    {
        foreach ([
            ['pet_name' => '<script>'], ['pet_breed' => str_repeat('x', 81)],
            ['pet_sex' => 'unknown'], ['pet_age' => '-1 Years'], ['pet_age' => '1.5 Years'],
            ['pet_vaccination_date' => '2026-02-30'], ['pet_type' => []], ['pet_id' => '7other'],
        ] as $change) {
            try {
                bookingPetEntries(['pets' => [$this->pet(), array_replace($this->pet('Milo'), $change)]]);
                $this->fail('Accepted invalid additional-pet details.');
            } catch (InvalidArgumentException $e) {
                $this->assertStringContainsString('Pet 2', $e->getMessage());
            }
        }
    }
}
