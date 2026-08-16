<?php
/**
 * BVetter – common-password blocklist
 *
 * These are BASE WORDS, not literal passwords. The candidate password is
 * normalised before it is compared (see passwordBaseWord() in
 * security_settings.php): trailing digits and punctuation are stripped and
 * common character substitutions are undone, so a single entry here also
 * rejects the decorated variants people actually type.
 *
 *   password  also blocks  Password1!  P@ssw0rd!  passw0rd2025  Password123!
 *   welcome   also blocks  Welcome2025!  W3lcome!
 *   baliwag   also blocks  Baliwag2025!  B@liwag123
 *
 * This matters more than it looks: with a 12-character four-class floor, the
 * classic weak passwords already fail on length or composition. What gets
 * through is "Password123!" — technically compliant and among the first
 * things any attacker tries. This list is aimed squarely at those.
 *
 * Includes local-context words (city, clinic, project, common Filipino
 * terms) because a Baliwag clinic's staff passwords are far likelier to be
 * guessed from those than from a generic global list.
 */

return [
    // Classic global favourites
    'password', 'passwd', 'pass', 'letmein', 'welcome', 'admin', 'administrator',
    'root', 'toor', 'login', 'guest', 'user', 'test', 'testing', 'demo', 'sample',
    'default', 'changeme', 'secret', 'secure', 'access', 'master', 'superman',
    'batman', 'trustno', 'starwars', 'pokemon', 'football', 'baseball', 'basketball',
    'soccer', 'hockey', 'dragon', 'monkey', 'shadow', 'sunshine', 'princess',
    'flower', 'butterfly', 'chocolate', 'cookie', 'freedom', 'whatever', 'nothing',
    'anything', 'something', 'computer', 'internet', 'samsung', 'google', 'facebook',
    'instagram', 'twitter', 'tiktok', 'youtube', 'netflix', 'spotify', 'amazon',
    'apple', 'microsoft', 'windows', 'android', 'iphone', 'samsunggalaxy',

    // Keyboard walks
    'qwerty', 'qwertyuiop', 'asdf', 'asdfgh', 'asdfghjkl', 'zxcvbn', 'zxcvbnm',
    'qazwsx', 'qwertz', 'azerty', 'poiuy', 'lkjhg', 'mnbvcxz', 'abcdef', 'abcdefg',
    'abcabc', 'aaaaaa', 'ababab', 'qweasd', 'qweqwe', 'asdasd', 'zaqxsw', 'wasd',

    // Words that survive composition rules
    'welcomeback', 'newpassword', 'mypassword', 'yourpassword', 'temppassword',
    'temporary', 'temp', 'reset', 'resetpassword', 'forgot', 'initial', 'firstlogin',
    'january', 'february', 'march', 'april', 'june', 'july', 'august', 'september',
    'october', 'november', 'december', 'summer', 'winter', 'spring', 'autumn',
    'monday', 'friday', 'weekend', 'holiday', 'birthday', 'christmas', 'newyear',
    'happy', 'happynewyear', 'merrychristmas', 'iloveyou', 'ilovemyself',
    'loveyou', 'lovely', 'forever', 'always', 'together', 'family', 'mother',
    'father', 'brother', 'sister', 'children', 'baby',

    // Project, clinic and role words — first guesses for this system
    'bvetter', 'vbetter', 'better', 'vetter', 'veterinary', 'veterinarian', 'vet',
    'vetclinic', 'clinic', 'animal', 'animalclinic', 'petclinic', 'pets', 'pet',
    'petowner', 'owner', 'doctor', 'nurse', 'staff', 'clerk', 'encoder', 'record',
    'records', 'patient', 'patients', 'appointment', 'appointments', 'vaccine',
    'vaccination', 'rabies', 'checkup', 'treatment', 'medicine', 'health',
    'adminadmin', 'adminpassword', 'admin', 'vetadmin', 'clinicadmin',
    'thesis', 'capstone', 'project', 'system', 'database', 'server', 'backup',

    // Local context
    'baliwag', 'baliuag', 'bulacan', 'philippines', 'pilipinas', 'filipino',
    'pinoy', 'manila', 'quezon', 'makati', 'cebu', 'davao', 'luzon', 'visayas',
    'mindanao', 'barangay', 'poblacion', 'tiaong', 'sanjose', 'tangos', 'sulivan',
    'makinabang', 'tibag', 'pagala', 'bagongnayon', 'pinagbarilan', 'virgendelasflores',
    'mahalkita', 'mahalko', 'salamat', 'kumusta', 'maganda', 'gwapo', 'pogi',
    'ganda', 'kitakits', 'basta', 'walang', 'ako', 'ikaw', 'tayo', 'puso',
    'asomatic', 'aso', 'pusa', 'alaga', 'bahay', 'trabaho', 'pamilya', 'kaibigan',

    // Names commonly used as passwords
    'michael', 'jennifer', 'jessica', 'ashley', 'daniel', 'joshua', 'andrew',
    'matthew', 'nicole', 'angel', 'angelo', 'maria', 'mary', 'jose', 'juan',
    'antonio', 'cristina', 'patricia', 'rose', 'grace', 'joy', 'faith', 'hope',
];
