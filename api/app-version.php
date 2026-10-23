<?php
declare(strict_types=1);

/**
 * Public fingerprint for browser-side app updates. File paths and fingerprints
 * contribute to the hash; none of them are returned.
 */
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Pragma: no-cache');

$projectRoot = dirname(__DIR__);
$trackedDirectories = ['public', 'admin', 'vet', 'shared'];
$fingerprints = [];

foreach ($trackedDirectories as $directoryName) {
    $directory = $projectRoot . DIRECTORY_SEPARATOR . $directoryName;
    if (!is_dir($directory)) continue;

    $iterator = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($directory, FilesystemIterator::SKIP_DOTS)
    );
    foreach ($iterator as $file) {
        if (!$file->isFile()) continue;
        $path = $file->getPathname();
        $relativePath = str_replace('\\', '/', substr($path, strlen($projectRoot) + 1));
        $extension = strtolower(pathinfo($path, PATHINFO_EXTENSION));
        if (in_array($extension, ['html', 'js', 'css', 'php', 'json', 'svg', 'txt', 'xml'], true)) {
            $contentFingerprint = hash_file('sha256', $path);
        } else {
            $contentFingerprint = $file->getMTime() . ':' . $file->getSize();
        }
        $fingerprints[] = $relativePath . ':' . ($contentFingerprint ?: 'unavailable');
    }
}

foreach (['sw.js', 'manifest.json'] as $rootAsset) {
    $path = $projectRoot . DIRECTORY_SEPARATOR . $rootAsset;
    if (is_file($path)) {
        $fingerprints[] = $rootAsset . ':' . hash_file('sha256', $path);
    }
}

sort($fingerprints, SORT_STRING);
$version = substr(hash('sha256', implode("\n", $fingerprints)), 0, 16);
echo json_encode(['version' => $version], JSON_UNESCAPED_SLASHES);
