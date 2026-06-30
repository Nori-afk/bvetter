<?php
// save as: Final-Backend/backend/analytics/diagnose.php
set_time_limit(120);
ini_set('max_execution_time', 120);
ini_set('display_errors', 1);
error_reporting(E_ALL);

echo "<h3>Step 1 — PHP Info</h3>";
echo "PHP version: " . phpversion() . "<br>";
echo "cURL enabled: " . (function_exists('curl_init') ? 'YES' : 'NO') . "<br>";
echo "Max execution time: " . ini_get('max_execution_time') . "s<br>";

echo "<h3>Step 2 — Can PHP reach port 5001?</h3>";
$fp = @fsockopen('192.168.1.25', 5001, $errno, $errstr, 5);
if ($fp) {
    echo "Socket connection: SUCCESS<br>";
    fclose($fp);
} else {
    echo "Socket connection: FAILED — $errstr ($errno)<br>";
}

echo "<h3>Step 3 — Health check</h3>";
$ch = curl_init('http://192.168.1.25:5001/health');
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_TIMEOUT,        10);
curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 5);
$result = curl_exec($ch);
$error  = curl_error($ch);
$errno  = curl_errno($ch);
curl_close($ch);
echo "Health result: " . ($error ? "FAILED ($errno): $error" : $result) . "<br>";

echo "<h3>Step 4 — Small forecast (1 barangay)</h3>";
$payload = json_encode(['barangays' => ['Tiaong'], 'steps' => 1]);
$ch = curl_init('http://192.168.1.25:5001/forecast');
curl_setopt($ch, CURLOPT_POST,           true);
curl_setopt($ch, CURLOPT_POSTFIELDS,     $payload);
curl_setopt($ch, CURLOPT_HTTPHEADER,     ['Content-Type: application/json']);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_TIMEOUT,        30);
curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 5);
$result = curl_exec($ch);
$error  = curl_error($ch);
$errno  = curl_errno($ch);
curl_close($ch);
echo "Forecast result: " . ($error ? "FAILED ($errno): $error" : $result) . "<br>";