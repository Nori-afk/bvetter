<?php

header('Content-Type: application/json');

require_once __DIR__ . '/../config/connection.php';

function respond($statusCode, $payload)
{
    http_response_code($statusCode);
    echo json_encode($payload);
    exit;
}

function inputData()
{
    $json = json_decode(file_get_contents('php://input'), true);
    if (is_array($json)) {
        return array_merge($_POST, $json);
    }
    return $_POST;
}

function clean($value)
{
    return trim((string) $value);
}

function normalizeStatus($value)
{
    return strtolower(clean($value)) === 'inactive' ? 'inactive' : 'active';
}

function normalizeDuration($value)
{
    $value = strtolower(clean($value));
    if ($value === '<24h' || strpos($value, 'less') !== false) return 'Less Than 24 Hours';
    if (strpos($value, 'more') !== false || strpos($value, '>3') !== false) return 'More than 3 days';
    return '1-3 Days';
}

function normalizePetType($value)
{
    $value = strtolower(clean($value));
    if (strpos($value, 'cat') === 0) return 'Cat';
    if (strpos($value, 'dog') === 0) return 'Dog';
    return 'Other';
}

function normalizeSeverity($value)
{
    $value = strtolower(clean($value));
    if (strpos($value, 'not moving') !== false || strpos($value, 'critical') !== false || strpos($value, 'emergency') !== false) return 'Critical';
    if (strpos($value, 'weak') !== false || strpos($value, 'moderate') !== false) return 'Moderate';
    return 'Active';
}

function decodeSymptoms($value)
{
    if (is_array($value)) {
        return array_values(array_filter(array_map('clean', $value)));
    }

    $value = clean($value);
    if ($value === '') return [];

    $decoded = json_decode($value, true);
    if (is_array($decoded)) {
        return array_values(array_filter(array_map('clean', $decoded)));
    }

    return array_values(array_filter(array_map('clean', explode(',', $value))));
}

function setupChatbotTables($pdo)
{
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS chatbot_inquiry_rules (
            id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(120) NOT NULL,
            icon VARCHAR(60) NOT NULL DEFAULT 'chat',
            response TEXT NOT NULL,
            action_type VARCHAR(30) NOT NULL DEFAULT 'no-action',
            action_label VARCHAR(120) NULL,
            redirect_page VARCHAR(160) NULL,
            button_label VARCHAR(120) NULL,
            status ENUM('active','inactive') NOT NULL DEFAULT 'active',
            usage_count INT NOT NULL DEFAULT 0,
            created_by_user_id INT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_chatbot_inquiry_status (status)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");

    $pdo->exec("
        CREATE TABLE IF NOT EXISTS chatbot_consultation_rules (
            id INT AUTO_INCREMENT PRIMARY KEY,
            pet_type VARCHAR(40) NOT NULL,
            age_group VARCHAR(40) NULL,
            symptoms_json JSON NOT NULL,
            duration VARCHAR(40) NOT NULL,
            severity VARCHAR(40) NOT NULL DEFAULT 'Active',
            barangay_id INT NULL,
            condition_title VARCHAR(160) NOT NULL,
            recommendation TEXT NOT NULL,
            action_type ENUM('home_care','monitor_24hrs','book_appointment','emergency_visit') NOT NULL DEFAULT 'monitor_24hrs',
            status ENUM('active','inactive') NOT NULL DEFAULT 'active',
            usage_count INT NOT NULL DEFAULT 0,
            created_by_user_id INT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_chatbot_consult_status (status),
            INDEX idx_chatbot_consult_pet (pet_type),
            INDEX idx_chatbot_consult_duration (duration),
            INDEX idx_chatbot_consult_severity (severity)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");

    $pdo->exec("
        CREATE TABLE IF NOT EXISTS chatbot_consultation_logs (
            id INT AUTO_INCREMENT PRIMARY KEY,
            pet_type VARCHAR(40) NOT NULL,
            age_group VARCHAR(40) NULL,
            symptoms_json JSON NOT NULL,
            duration VARCHAR(40) NOT NULL,
            severity VARCHAR(40) NOT NULL,
            barangay_id INT NULL,
            matched_rule_id INT NULL,
            recommended_action VARCHAR(40) NOT NULL,
            recommendation TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_chatbot_logs_created (created_at),
            INDEX idx_chatbot_logs_barangay (barangay_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");

    $pdo->exec("
        CREATE TABLE IF NOT EXISTS chatbot_inquiry_logs (
            id INT AUTO_INCREMENT PRIMARY KEY,
            inquiry_rule_id INT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_chatbot_inquiry_logs_rule (inquiry_rule_id),
            INDEX idx_chatbot_inquiry_logs_created (created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");

    $pdo->exec("
        DELETE duplicate_rules
        FROM chatbot_inquiry_rules duplicate_rules
        INNER JOIN chatbot_inquiry_rules original_rules
            ON duplicate_rules.name = original_rules.name
            AND duplicate_rules.id > original_rules.id
    ");

    $pdo->exec("
        DELETE duplicate_rules
        FROM chatbot_consultation_rules duplicate_rules
        INNER JOIN chatbot_consultation_rules original_rules
            ON duplicate_rules.pet_type = original_rules.pet_type
            AND duplicate_rules.duration = original_rules.duration
            AND duplicate_rules.severity = original_rules.severity
            AND duplicate_rules.condition_title = original_rules.condition_title
            AND duplicate_rules.symptoms_json = original_rules.symptoms_json
            AND duplicate_rules.id > original_rules.id
    ");
}

function seedDefaults($pdo)
{
    $count = (int) $pdo->query('SELECT COUNT(*) FROM chatbot_inquiry_rules')->fetchColumn();
    if ($count === 0) {
        $stmt = $pdo->prepare("
            INSERT INTO chatbot_inquiry_rules
                (name, icon, response, action_type, action_label, redirect_page, button_label)
            VALUES
                (:name, :icon, :response, :action_type, :action_label, :redirect_page, :button_label)
        ");

        $defaults = [
            ['Clinic Schedule', 'clock', "Monday - Friday\n8:00 AM - 5:00 PM\n\nSaturday\n8:00 AM - 12:00 PM by appointment\n\nSunday\nClosed", 'no-action', 'No action', '', ''],
            ['Vaccination Requirements', 'syringe', "Before vaccination, your pet should be healthy and free from fever, vomiting, diarrhea, or severe weakness.\n\nPlease bring any previous vaccination record and keep your pet secured with a leash or carrier.", 'no-action', 'No action', '', ''],
            ['Book Appointment', 'clipboard', 'You can book an appointment with our veterinary team on the appointment page.', 'redirect', 'Book Appointment', 'book-appointment.html', 'Book Appointment'],
            ['Lost and Found Procedure', 'link', "To report a lost or found pet, open the Lost & Found page, submit a clear photo, complete the pet details, and provide the last known barangay/location.\n\nOur team reviews reports and helps match possible owners.", 'redirect', 'Open Lost & Found', 'lost-found.html', 'Open Lost & Found'],
        ];

        foreach ($defaults as $row) {
            $stmt->execute([
                ':name' => $row[0],
                ':icon' => $row[1],
                ':response' => $row[2],
                ':action_type' => $row[3],
                ':action_label' => $row[4],
                ':redirect_page' => $row[5],
                ':button_label' => $row[6],
            ]);
        }
    }

    $count = (int) $pdo->query('SELECT COUNT(*) FROM chatbot_consultation_rules')->fetchColumn();
    if ($count === 0) {
        $stmt = $pdo->prepare("
            INSERT INTO chatbot_consultation_rules
                (pet_type, age_group, symptoms_json, duration, severity, condition_title, recommendation, action_type)
            VALUES
                (:pet_type, :age_group, :symptoms_json, :duration, :severity, :condition_title, :recommendation, :action_type)
        ");

        $defaults = [
            ['Dog', 'Any', ['Vomiting', 'Diarrhea'], 'Less Than 24 Hours', 'Active', 'Digestive Upset', "Recommended action: Monitor 24hrs\n\nHome care:\nProvide clean water, offer small bland meals, and observe energy level.\n\nBook an appointment if vomiting or diarrhea continues, blood appears, or your pet becomes weak.", 'monitor_24hrs'],
            ['Cat', 'Any', ['Loss of Appetite'], '1-3 Days', 'Moderate', 'Reduced Appetite', "Recommended action: Book appointment\n\nCats that do not eat for more than a day should be checked. Keep water available and avoid forcing food.", 'book_appointment'],
            ['Dog', 'Any', ['Seizures'], 'Less Than 24 Hours', 'Critical', 'Seizure Episode', "Recommended action: Emergency visit\n\nKeep your pet away from stairs or sharp objects, do not put your hand in the mouth, and bring the pet to the clinic immediately.", 'emergency_visit'],
            ['Dog', 'Any', ['Wounds'], '1-3 Days', 'Moderate', 'Open Wound or Injury', "Recommended action: Book appointment\n\nGently keep the wound clean and prevent licking. Visit the clinic for proper cleaning, medication, and wound assessment.", 'book_appointment'],
        ];

        foreach ($defaults as $row) {
            $stmt->execute([
                ':pet_type' => $row[0],
                ':age_group' => $row[1],
                ':symptoms_json' => json_encode($row[2]),
                ':duration' => $row[3],
                ':severity' => $row[4],
                ':condition_title' => $row[5],
                ':recommendation' => $row[6],
                ':action_type' => $row[7],
            ]);
        }
    }
}

function mapInquiry($row)
{
    return [
        'id' => (int) $row['id'],
        'name' => $row['name'],
        'title' => $row['name'],
        'icon' => $row['icon'],
        'response' => $row['response'],
        'actionType' => $row['action_type'],
        'action_type' => $row['action_type'],
        'actionLabel' => $row['action_label'] ?: ($row['action_type'] === 'no-action' ? 'No action' : 'Redirect'),
        'redirectPage' => $row['redirect_page'] ?: '',
        'redirect_page' => $row['redirect_page'] ?: '',
        'buttonLabel' => $row['button_label'] ?: '',
        'button_label' => $row['button_label'] ?: '',
        'status' => $row['status'],
        'count' => (int) $row['usage_count'],
        'usage_count' => (int) $row['usage_count'],
        'lastUpdated' => date('Y-m-d', strtotime($row['updated_at'])),
        'updated_at' => $row['updated_at'],
    ];
}

function mapConsultation($row)
{
    return [
        'id' => (int) $row['id'],
        'petType' => $row['pet_type'],
        'pet_type' => $row['pet_type'],
        'ageGroup' => $row['age_group'] ?: 'Any',
        'symptoms' => decodeSymptoms($row['symptoms_json']),
        'duration' => $row['duration'],
        'condition' => $row['condition_title'],
        'condition_title' => $row['condition_title'],
        'severity' => $row['severity'],
        'recommendation' => $row['recommendation'],
        'actionType' => $row['action_type'],
        'action_type' => $row['action_type'],
        'status' => $row['status'],
        'count' => (int) $row['usage_count'],
        'lastUpdate' => date('Y-m-d', strtotime($row['updated_at'])),
        'updated_at' => $row['updated_at'],
    ];
}

function listInquiryRules($pdo, $activeOnly = false)
{
    $sql = 'SELECT * FROM chatbot_inquiry_rules';
    if ($activeOnly) $sql .= " WHERE status = 'active'";
    $sql .= ' ORDER BY id ASC';
    $rows = $pdo->query($sql)->fetchAll();
    respond(200, ['success' => true, 'data' => array_map('mapInquiry', $rows)]);
}

function saveInquiryRule($pdo, $data)
{
    $id = (int) ($data['id'] ?? 0);
    $name = clean($data['name'] ?? $data['title'] ?? '');
    $response = clean($data['response'] ?? $data['answer'] ?? '');
    if ($name === '' || $response === '') {
        respond(422, ['success' => false, 'message' => 'Inquiry type and response are required.']);
    }

    $payload = [
        ':name' => $name,
        ':icon' => clean($data['icon'] ?? 'chat'),
        ':response' => $response,
        ':action_type' => clean($data['actionType'] ?? $data['action_type'] ?? 'no-action'),
        ':action_label' => clean($data['actionLabel'] ?? $data['action_label'] ?? ''),
        ':redirect_page' => clean($data['redirectPage'] ?? $data['redirect_page'] ?? ''),
        ':button_label' => clean($data['buttonLabel'] ?? $data['button_label'] ?? ''),
        ':status' => normalizeStatus($data['status'] ?? 'active'),
        ':created_by_user_id' => (int) ($data['created_by_user_id'] ?? $data['user_id'] ?? 0) ?: null,
    ];

    if ($id > 0) {
        unset($payload[':created_by_user_id']);
        $payload[':id'] = $id;
        $stmt = $pdo->prepare("
            UPDATE chatbot_inquiry_rules
            SET name = :name, icon = :icon, response = :response, action_type = :action_type,
                action_label = :action_label, redirect_page = :redirect_page, button_label = :button_label,
                status = :status
            WHERE id = :id
        ");
        $stmt->execute($payload);
    } else {
        $stmt = $pdo->prepare("
            INSERT INTO chatbot_inquiry_rules
                (name, icon, response, action_type, action_label, redirect_page, button_label, status, created_by_user_id)
            VALUES
                (:name, :icon, :response, :action_type, :action_label, :redirect_page, :button_label, :status, :created_by_user_id)
        ");
        $stmt->execute($payload);
        $id = (int) $pdo->lastInsertId();
    }

    $stmt = $pdo->prepare('SELECT * FROM chatbot_inquiry_rules WHERE id = :id');
    $stmt->execute([':id' => $id]);
    respond($id > 0 ? 200 : 201, ['success' => true, 'data' => mapInquiry($stmt->fetch())]);
}

function deleteInquiryRule($pdo, $data)
{
    $id = (int) ($data['id'] ?? $data['rule_id'] ?? 0);
    if ($id <= 0) respond(422, ['success' => false, 'message' => 'Invalid inquiry id.']);
    $stmt = $pdo->prepare('DELETE FROM chatbot_inquiry_rules WHERE id = :id');
    $stmt->execute([':id' => $id]);
    respond(200, ['success' => true, 'deleted' => $id]);
}

function listConsultationRules($pdo, $activeOnly = false)
{
    $sql = "SELECT * FROM chatbot_consultation_rules WHERE pet_type IN ('Dog', 'Cat', 'Other')";
    if ($activeOnly) $sql .= " AND status = 'active'";
    $sql .= ' ORDER BY id DESC';
    $rows = $pdo->query($sql)->fetchAll();
    respond(200, ['success' => true, 'data' => array_map('mapConsultation', $rows)]);
}

function saveConsultationRule($pdo, $data)
{
    $id = (int) ($data['id'] ?? 0);
    $petType = normalizePetType($data['petType'] ?? $data['pet_type'] ?? '');
    $symptoms = decodeSymptoms($data['symptoms'] ?? []);
    $duration = normalizeDuration($data['duration'] ?? '');
    $severity = normalizeSeverity($data['severity'] ?? '');
    $condition = clean($data['condition'] ?? $data['condition_title'] ?? '');
    $recommendation = clean($data['recommendation'] ?? '');

    if ($petType === '' || !$symptoms || $duration === '' || $condition === '' || $recommendation === '') {
        respond(422, ['success' => false, 'message' => 'Pet type, symptoms, duration, condition, and recommendation are required.']);
    }

    $actionType = clean($data['actionType'] ?? $data['action_type'] ?? '');
    if ($actionType === '') {
        $actionType = $severity === 'Critical' ? 'emergency_visit' : ($severity === 'Moderate' ? 'book_appointment' : 'monitor_24hrs');
    }

    $payload = [
        ':pet_type' => $petType,
        ':age_group' => clean($data['ageGroup'] ?? $data['age_group'] ?? 'Any') ?: 'Any',
        ':symptoms_json' => json_encode($symptoms),
        ':duration' => $duration,
        ':severity' => $severity,
        ':barangay_id' => (int) ($data['barangay_id'] ?? 0) ?: null,
        ':condition_title' => $condition,
        ':recommendation' => $recommendation,
        ':action_type' => $actionType,
        ':status' => normalizeStatus($data['status'] ?? 'active'),
        ':created_by_user_id' => (int) ($data['created_by_user_id'] ?? $data['user_id'] ?? 0) ?: null,
    ];

    if ($id > 0) {
        unset($payload[':created_by_user_id']);
        $payload[':id'] = $id;
        $stmt = $pdo->prepare("
            UPDATE chatbot_consultation_rules
            SET pet_type = :pet_type, age_group = :age_group, symptoms_json = :symptoms_json,
                duration = :duration, severity = :severity, barangay_id = :barangay_id,
                condition_title = :condition_title, recommendation = :recommendation,
                action_type = :action_type, status = :status
            WHERE id = :id
        ");
        $stmt->execute($payload);
    } else {
        $stmt = $pdo->prepare("
            INSERT INTO chatbot_consultation_rules
                (pet_type, age_group, symptoms_json, duration, severity, barangay_id, condition_title, recommendation, action_type, status, created_by_user_id)
            VALUES
                (:pet_type, :age_group, :symptoms_json, :duration, :severity, :barangay_id, :condition_title, :recommendation, :action_type, :status, :created_by_user_id)
        ");
        $stmt->execute($payload);
        $id = (int) $pdo->lastInsertId();
    }

    $stmt = $pdo->prepare('SELECT * FROM chatbot_consultation_rules WHERE id = :id');
    $stmt->execute([':id' => $id]);
    respond(200, ['success' => true, 'data' => mapConsultation($stmt->fetch())]);
}

function deleteConsultationRule($pdo, $data)
{
    $id = (int) ($data['id'] ?? $data['rule_id'] ?? 0);
    if ($id <= 0) respond(422, ['success' => false, 'message' => 'Invalid consultation id.']);
    $stmt = $pdo->prepare('DELETE FROM chatbot_consultation_rules WHERE id = :id');
    $stmt->execute([':id' => $id]);
    respond(200, ['success' => true, 'deleted' => $id]);
}

function scoreRule($rule, $petType, $symptoms, $duration, $severity)
{
    $score = 0;
    if ($rule['pet_type'] === $petType || $rule['pet_type'] === 'Other') $score += 2;
    if ($rule['duration'] === $duration) $score += 2;
    if ($rule['severity'] === $severity) $score += 2;

    $ruleSymptoms = decodeSymptoms($rule['symptoms_json']);
    foreach ($symptoms as $symptom) {
        if (in_array($symptom, $ruleSymptoms, true)) $score += 3;
    }
    return $score;
}

function fallbackAssessment($symptoms, $duration, $severity)
{
    $criticalSymptoms = ['Seizures', 'Wounds'];
    $hasCriticalSymptom = count(array_intersect($criticalSymptoms, $symptoms)) > 0;

    if ($severity === 'Critical' || $hasCriticalSymptom) {
        return [
            'condition' => 'Urgent Warning Signs',
            'action_type' => 'emergency_visit',
            'level' => 'high',
            'recommendation' => "Recommended action: Emergency visit\n\nKeep your pet calm and avoid giving human medicine. If your pet has seizures, severe wounds, collapse, difficulty breathing, or cannot stand, bring them to the clinic immediately.",
        ];
    }

    if ($severity === 'Moderate' || $duration === 'More than 3 days' || count($symptoms) >= 3) {
        return [
            'condition' => 'Needs Veterinary Attention',
            'action_type' => 'book_appointment',
            'level' => 'moderate',
            'recommendation' => "Recommended action: Book appointment\n\nHome care: keep fresh water available, limit activity, and monitor symptoms. Because symptoms are persistent or your pet is weak, schedule a veterinary checkup as soon as possible.",
        ];
    }

    return [
        'condition' => 'Mild Symptoms',
        'action_type' => 'monitor_24hrs',
        'level' => 'low',
        'recommendation' => "Recommended action: Monitor 24hrs\n\nHome care: provide clean water, keep your pet comfortable, and observe eating, drinking, stool, and energy. Book an appointment if symptoms worsen or continue.",
    ];
}

function actionLevel($actionType)
{
    if ($actionType === 'emergency_visit') return 'high';
    if ($actionType === 'book_appointment') return 'moderate';
    return 'low';
}

function assessConsultation($pdo, $data)
{
    $petType = normalizePetType($data['petType'] ?? $data['pet_type'] ?? '');
    $ageGroup = clean($data['ageGroup'] ?? $data['age_group'] ?? '');
    $duration = normalizeDuration($data['duration'] ?? '');
    $severity = normalizeSeverity($data['severity'] ?? '');
    $barangayId = (int) ($data['barangay_id'] ?? 0) ?: null;
    $symptoms = decodeSymptoms($data['symptoms'] ?? []);

    if ($petType === '' || !$symptoms || $duration === '' || $severity === '') {
        respond(422, ['success' => false, 'message' => 'Pet type, symptoms, duration, and severity are required.']);
    }

    $rows = $pdo->query("SELECT * FROM chatbot_consultation_rules WHERE status = 'active'")->fetchAll();
    $best = null;
    $bestScore = 0;
    foreach ($rows as $row) {
        $score = scoreRule($row, $petType, $symptoms, $duration, $severity);
        if ($score > $bestScore) {
            $best = $row;
            $bestScore = $score;
        }
    }

    if ($best && $bestScore >= 4) {
        $result = [
            'condition' => $best['condition_title'],
            'action_type' => $best['action_type'],
            'level' => actionLevel($best['action_type']),
            'recommendation' => $best['recommendation'],
            'matched_rule_id' => (int) $best['id'],
            'score' => $bestScore,
        ];
        $stmt = $pdo->prepare('UPDATE chatbot_consultation_rules SET usage_count = usage_count + 1 WHERE id = :id');
        $stmt->execute([':id' => $best['id']]);
    } else {
        $result = fallbackAssessment($symptoms, $duration, $severity);
        $result['matched_rule_id'] = null;
        $result['score'] = $bestScore;
    }

    $stmt = $pdo->prepare("
        INSERT INTO chatbot_consultation_logs
            (pet_type, age_group, symptoms_json, duration, severity, barangay_id, matched_rule_id, recommended_action, recommendation)
        VALUES
            (:pet_type, :age_group, :symptoms_json, :duration, :severity, :barangay_id, :matched_rule_id, :recommended_action, :recommendation)
    ");
    $stmt->execute([
        ':pet_type' => $petType,
        ':age_group' => $ageGroup ?: null,
        ':symptoms_json' => json_encode($symptoms),
        ':duration' => $duration,
        ':severity' => $severity,
        ':barangay_id' => $barangayId,
        ':matched_rule_id' => $result['matched_rule_id'],
        ':recommended_action' => $result['action_type'],
        ':recommendation' => $result['recommendation'],
    ]);

    respond(200, [
        'success' => true,
        'data' => [
            'petType' => $petType,
            'ageGroup' => $ageGroup,
            'symptoms' => $symptoms,
            'duration' => $duration,
            'severity' => $severity,
            'barangay_id' => $barangayId,
            'condition' => $result['condition'],
            'level' => $result['level'],
            'actionType' => $result['action_type'],
            'recommendation' => $result['recommendation'],
            'matchedRuleId' => $result['matched_rule_id'],
        ],
    ]);
}

function recordInquiryUse($pdo, $data)
{
    $id = (int) ($data['id'] ?? $data['rule_id'] ?? 0);
    if ($id <= 0) respond(422, ['success' => false, 'message' => 'Invalid inquiry id.']);
    $stmt = $pdo->prepare('UPDATE chatbot_inquiry_rules SET usage_count = usage_count + 1 WHERE id = :id');
    $stmt->execute([':id' => $id]);
    $stmt = $pdo->prepare('INSERT INTO chatbot_inquiry_logs (inquiry_rule_id) VALUES (:id)');
    $stmt->execute([':id' => $id]);
    respond(200, ['success' => true]);
}

function monthKeys($months = 12)
{
    $keys = [];
    $labels = [];
    $start = new DateTime('first day of this month');
    $start->modify('-' . ($months - 1) . ' months');

    for ($i = 0; $i < $months; $i++) {
        $current = clone $start;
        $current->modify('+' . $i . ' months');
        $keys[] = $current->format('Y-m');
        $labels[] = $current->format('M');
    }

    return [$keys, $labels];
}

function keyedCounts($rows, $keys)
{
    $counts = array_fill_keys($keys, 0);
    foreach ($rows as $row) {
        if (isset($counts[$row['period']])) {
            $counts[$row['period']] = (int) $row['total'];
        }
    }
    return array_values($counts);
}

function topSymptomData($logs, $petType = 'all')
{
    $counts = [];
    foreach ($logs as $row) {
        if ($petType !== 'all' && strtolower($row['pet_type']) !== $petType) continue;
        foreach (decodeSymptoms($row['symptoms_json']) as $symptom) {
            if ($symptom === '' || strtolower($symptom) === 'no listed symptoms') continue;
            $counts[$symptom] = ($counts[$symptom] ?? 0) + 1;
        }
    }

    arsort($counts);
    $counts = array_slice($counts, 0, 10, true);
    return [
        'labels' => array_keys($counts),
        'values' => array_values($counts),
    ];
}

function dashboardStats($pdo)
{
    [$monthKeys, $monthLabels] = monthKeys(12);

    $consultRows = $pdo->query("
        SELECT DATE_FORMAT(created_at, '%Y-%m') AS period, COUNT(*) AS total
        FROM chatbot_consultation_logs
        WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
        GROUP BY period
    ")->fetchAll();

    $inquiryRows = $pdo->query("
        SELECT DATE_FORMAT(created_at, '%Y-%m') AS period, COUNT(*) AS total
        FROM chatbot_inquiry_logs
        WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
        GROUP BY period
    ")->fetchAll();

    $inquiryDistribution = $pdo->query("
        SELECT name, usage_count
        FROM chatbot_inquiry_rules
        ORDER BY usage_count DESC, name ASC
        LIMIT 10
    ")->fetchAll();

    $symptomLogs = $pdo->query("
        SELECT pet_type, symptoms_json
        FROM chatbot_consultation_logs
    ")->fetchAll();

    $locationRows = $pdo->query("
        SELECT COALESCE(barangays.name, 'Unspecified') AS name, COUNT(*) AS total
        FROM chatbot_consultation_logs
        LEFT JOIN barangays ON barangays.id = chatbot_consultation_logs.barangay_id
        GROUP BY name
        ORDER BY total DESC, name ASC
        LIMIT 10
    ")->fetchAll();

    $totalConsultations = (int) $pdo->query('SELECT COUNT(*) FROM chatbot_consultation_logs')->fetchColumn();
    $totalInquiries = (int) $pdo->query('SELECT COALESCE(SUM(usage_count), 0) FROM chatbot_inquiry_rules')->fetchColumn();
    $matchedConsultations = (int) $pdo->query('SELECT COUNT(*) FROM chatbot_consultation_logs WHERE matched_rule_id IS NOT NULL')->fetchColumn();

    $symptomsAll = topSymptomData($symptomLogs, 'all');
    $mostCommonSymptom = 'No data yet';
    if (!empty($symptomsAll['labels'])) {
        $mostCommonSymptom = $symptomsAll['labels'][0] . ' (' . $symptomsAll['values'][0] . ' cases/chats)';
    }

    respond(200, [
        'success' => true,
        'data' => [
            'kpis' => [
                'totalConsultations' => $totalConsultations,
                'totalInquiries' => $totalInquiries,
                'mostCommonSymptom' => $mostCommonSymptom,
                'consultationSuccessRate' => $totalConsultations > 0 ? round(($matchedConsultations / $totalConsultations) * 100, 1) : 0,
                'inquirySuccessRate' => $totalInquiries > 0 ? 100 : 0,
            ],
            'trend' => [
                'labels' => $monthLabels,
                'consultation' => keyedCounts($consultRows, $monthKeys),
                'inquiry' => keyedCounts($inquiryRows, $monthKeys),
            ],
            'inquiryDistribution' => [
                'labels' => array_map(function ($row) { return $row['name']; }, $inquiryDistribution),
                'values' => array_map(function ($row) { return (int) $row['usage_count']; }, $inquiryDistribution),
            ],
            'symptomsByPetType' => [
                'all' => $symptomsAll,
                'dog' => topSymptomData($symptomLogs, 'dog'),
                'cat' => topSymptomData($symptomLogs, 'cat'),
                'other' => topSymptomData($symptomLogs, 'other'),
            ],
            'locations' => array_map(function ($row) {
                return [
                    'name' => $row['name'],
                    'count' => (int) $row['total'],
                ];
            }, $locationRows),
        ],
    ]);
}

$input = inputData();
$action = clean($input['action'] ?? 'list_inquiries');

try {
    setupChatbotTables($pdo);
    seedDefaults($pdo);

    if ($action === 'list_inquiries') listInquiryRules($pdo, false);
    if ($action === 'public_inquiries') listInquiryRules($pdo, true);
    if ($action === 'save_inquiry') saveInquiryRule($pdo, $input);
    if ($action === 'delete_inquiry') deleteInquiryRule($pdo, $input);
    if ($action === 'record_inquiry_use') recordInquiryUse($pdo, $input);
    if ($action === 'dashboard_stats') dashboardStats($pdo);

    if ($action === 'list_consultations') listConsultationRules($pdo, false);
    if ($action === 'public_consultations') listConsultationRules($pdo, true);
    if ($action === 'save_consultation') saveConsultationRule($pdo, $input);
    if ($action === 'delete_consultation') deleteConsultationRule($pdo, $input);
    if ($action === 'assess_consultation') assessConsultation($pdo, $input);

    respond(400, ['success' => false, 'message' => 'Unknown chatbot action.']);
} catch (PDOException $e) {
    respond(500, [
        'success' => false,
        'message' => 'Chatbot request failed.',
        'error' => $e->getMessage(),
    ]);
}
