<?php

/**
 * CLI-only diagnostic: prints exactly what the app sees for the Brevo/SMTP
 * config, then makes ONE real send attempt and prints Brevo's raw response
 * (not just true/false) so a failure is diagnosable without digging through
 * log files. Delete this file once email is confirmed working — it's not
 * meant to be a permanent part of the app.
 *
 * Usage: php mailer_diagnose.php you@example.com
 */

if (php_sapi_name() !== 'cli') {
    http_response_code(403);
    exit('CLI only');
}

require_once __DIR__ . '/connection.php';
require_once __DIR__ . '/mailer.php';

function maskSecret(string $value): string
{
    if ($value === '') return '(empty)';
    $len = strlen($value);
    if ($len <= 8) return str_repeat('*', $len);
    return substr($value, 0, 4) . str_repeat('*', $len - 8) . substr($value, -4) . " ({$len} chars)";
}

echo "=== Config as PHP sees it ===\n";
$brevoKey = getenv('BREVO_API_KEY') ?: '';
echo "BREVO_API_KEY:    " . maskSecret($brevoKey) . "\n";
echo "BREVO_FROM_EMAIL: '" . getenv('BREVO_FROM_EMAIL') . "'\n";
echo "BREVO_FROM_NAME:  '" . getenv('BREVO_FROM_NAME') . "'\n";
echo "MAIL_FROM_NAME:   '" . getenv('MAIL_FROM_NAME') . "'\n";
echo "SMTP_FROM:        '" . getenv('SMTP_FROM') . "'\n";
echo "SMTP_HOST:        '" . getenv('SMTP_HOST') . "'\n";
echo "\n";

if (trim($brevoKey) !== $brevoKey) {
    echo "!! WARNING: BREVO_API_KEY has leading/trailing whitespace — check .env for a stray space.\n";
}
if (strpos($brevoKey, '"') !== false || strpos($brevoKey, "'") !== false) {
    echo "!! WARNING: BREVO_API_KEY contains a quote character — .env values should NOT be quoted.\n";
}

$toEmail = $argv[1] ?? '';
if ($toEmail === '') {
    echo "No test recipient given — run again as: php mailer_diagnose.php you@example.com\n";
    exit;
}

if ($brevoKey === '') {
    echo "BREVO_API_KEY is empty — sendAppMail() will fall through to SMTP, which is what we're trying to avoid.\n";
    exit;
}

echo "=== Making one real Brevo API call to {$toEmail} ===\n";

$fromEmail = getenv('BREVO_FROM_EMAIL') ?: getenv('SMTP_FROM') ?: '';
$fromName = getenv('MAIL_FROM_NAME') ?: getenv('BREVO_FROM_NAME') ?: 'BVetter';

$payload = [
    'sender' => ['name' => $fromName, 'email' => $fromEmail],
    'to' => [['email' => $toEmail]],
    'subject' => 'BVetter mailer diagnostic',
    'htmlContent' => '<p>If you got this, the app-level Brevo path works.</p>',
];

echo "Request sender: {$fromName} <{$fromEmail}>\n";
echo "Request payload: " . json_encode($payload) . "\n\n";

$ch = curl_init('https://api.brevo.com/v3/smtp/email');
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_POST => true,
    CURLOPT_POSTFIELDS => json_encode($payload),
    CURLOPT_HTTPHEADER => [
        'accept: application/json',
        'content-type: application/json',
        'api-key: ' . $brevoKey,
    ],
    CURLOPT_TIMEOUT => 15,
]);
$response = curl_exec($ch);
$statusCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$curlError = curl_error($ch);
curl_close($ch);

echo "HTTP status: {$statusCode}\n";
echo "curl error:  " . ($curlError ?: '(none)') . "\n";
echo "Raw response: {$response}\n\n";

if ($statusCode >= 200 && $statusCode < 300) {
    echo "=> SUCCESS. Check {$toEmail}'s inbox (and spam folder).\n";
} else {
    echo "=> FAILED. The message above from Brevo is the exact reason — common ones:\n";
    echo "   - 'invalid sender email' / sender not verified in Brevo's Senders list\n";
    echo "   - 'Key not found' — the API key itself is wrong/revoked\n";
    echo "   - 'unauthorized' — header wasn't sent correctly (shouldn't happen here)\n";
}
