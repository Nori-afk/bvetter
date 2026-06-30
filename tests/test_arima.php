<?php
set_time_limit(120);
ini_set('max_execution_time', 120);

// Only request top 8 instead of all 26
$payload = json_encode([
    'barangays' => ['Tiaong', 'Poblacion', 'San Jose', 'Tangos', 
                    'Bagong Nayon', 'Sulivan', 'Pagala', 'Virgen Delas Flores'],
    'steps' => 3
]);
$ch = curl_init('http://192.168.1.25:5001/forecast');
curl_setopt($ch, CURLOPT_POST,           true);
curl_setopt($ch, CURLOPT_POSTFIELDS,     $payload);
curl_setopt($ch, CURLOPT_HTTPHEADER,     ['Content-Type: application/json']);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_TIMEOUT,        60);
curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 5);
$result = curl_exec($ch);
$error  = curl_error($ch);
curl_close($ch);

echo $error ? "CURL ERROR: $error" : $result;