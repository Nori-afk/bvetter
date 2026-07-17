-- phpMyAdmin SQL Dump
-- version 5.2.1
-- https://www.phpmyadmin.net/
--
-- Host: 127.0.0.1
-- Generation Time: Jun 17, 2026 at 01:10 PM
-- Server version: 8.0.40
-- PHP Version: 8.0.30

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+00:00";


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;

--
-- Database: `bvetter`
--

-- --------------------------------------------------------

--
-- Table structure for table `announcements`
--

CREATE TABLE `announcements` (
  `id` int NOT NULL,
  `title` varchar(180) NOT NULL,
  `description` text NOT NULL,
  `category` varchar(80) NOT NULL DEFAULT 'Preventative Care',
  `event_date` date DEFAULT NULL,
  `location` varchar(180) DEFAULT NULL,
  `image_path` varchar(255) DEFAULT NULL,
  `status` enum('draft','published','archived') NOT NULL DEFAULT 'published',
  `created_by_user_id` int DEFAULT NULL,
  `created_by_role` varchar(40) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

--
-- Dumping data for table `announcements`
--

INSERT INTO `announcements` (`id`, `title`, `description`, `category`, `event_date`, `location`, `image_path`, `status`, `created_by_user_id`, `created_by_role`, `created_at`, `updated_at`) VALUES
(1, 'Clinic Wellness Advisory', 'Bring updated vaccination records during upcoming community visits.', 'Community Advisory', '2026-06-15', 'Baliwag City Veterinary Services', NULL, 'published', NULL, 'admin', '2026-06-02 14:08:53', '2026-06-02 14:08:53'),
(2, 'asdasdasda', 'adasd', 'Preventative Care', NULL, NULL, '/Final-Backend/backend/uploads/announcements/announcement_1780409397_3d6cdba54cdb.png', 'published', NULL, 'vet', '2026-06-02 14:09:57', '2026-06-04 08:27:30'),
(3, 'vaccines', 'asdad', 'Health & Wellness', '2026-06-05', 'SM', '/Final-Backend/backend/uploads/announcements/announcement_1780562044_dc41ff8321c4.png', 'published', NULL, 'vet', '2026-06-04 08:34:04', '2026-06-04 08:34:04');

-- --------------------------------------------------------

--
-- Table structure for table `appointments`
--

CREATE TABLE `appointments` (
  `id` int NOT NULL,
  `owner_id` int NOT NULL,
  `pet_id` int NOT NULL,
  `veterinarian_id` int DEFAULT NULL,
  `appointment_type` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `preferred_date` date NOT NULL,
  `time_slot` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` enum('pending','confirmed','completed','cancelled','rejected') COLLATE utf8mb4_unicode_ci DEFAULT 'pending',
  `description` text COLLATE utf8mb4_unicode_ci,
  `notes` text COLLATE utf8mb4_unicode_ci,
  `confirmed_at` datetime DEFAULT NULL,
  `cancelled_at` datetime DEFAULT NULL,
  `reviewed_by_user_id` int DEFAULT NULL,
  `review_notes` text COLLATE utf8mb4_unicode_ci,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `appointments`
--

INSERT INTO `appointments` (`id`, `owner_id`, `pet_id`, `veterinarian_id`, `appointment_type`, `preferred_date`, `time_slot`, `status`, `description`, `notes`, `confirmed_at`, `cancelled_at`, `reviewed_by_user_id`, `review_notes`, `created_at`, `updated_at`) VALUES
(1, 3, 1, NULL, 'Consultation', '2026-05-18', '2:00 PM', 'cancelled', '', '', '2026-05-18 23:12:58', '2026-05-19 16:47:44', NULL, '', '2026-05-18 15:10:54', '2026-05-19 08:47:44'),
(4, 3, 3, 6, 'Vaccination', '2026-05-20', '11:00 AM', 'completed', '', '', '2026-05-19 17:30:58', NULL, NULL, '', '2026-05-19 09:30:33', '2026-05-19 17:07:20');

-- --------------------------------------------------------

--
-- Table structure for table `barangays`
--

CREATE TABLE `barangays` (
  `id` int NOT NULL,
  `name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `city` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT 'Baliwag',
  `province` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT 'Bulacan',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `barangays`
--

INSERT INTO `barangays` (`id`, `name`, `city`, `province`, `created_at`, `updated_at`) VALUES
(3, 'Tiaong', 'Baliwag', 'Bulacan', '2026-05-18 10:26:42', '2026-05-18 10:26:42'),
(4, 'San Jose', 'Baliwag', 'Bulacan', '2026-05-18 10:26:42', '2026-05-18 10:26:42'),
(5, 'Poblacion', 'Baliwag', 'Bulacan', '2026-05-18 10:26:42', '2026-05-18 10:26:42'),
(6, 'Sulivan', 'Baliwag', 'Bulacan', '2026-05-18 10:26:42', '2026-05-18 10:26:42'),
(7, 'Tangos', 'Baliwag', 'Bulacan', '2026-05-18 10:26:42', '2026-05-18 10:26:42'),
(8, 'Bagong Nayon', 'Baliwag', 'Bulacan', '2026-05-18 10:26:42', '2026-05-18 10:26:42'),
(9, 'Pagala', 'Baliwag', 'Bulacan', '2026-05-18 10:26:42', '2026-05-18 10:26:42'),
(10, 'Pinagbarilan', 'Baliwag', 'Bulacan', '2026-05-18 10:26:42', '2026-05-18 10:26:42'),
(11, 'Virgen Delas Flores', 'Baliwag', 'Bulacan', '2026-05-18 10:26:42', '2026-05-18 10:26:42'),
(12, 'Tarcan', 'Baliwag', 'Bulacan', '2026-05-18 10:26:42', '2026-05-18 10:26:42'),
(13, 'Makinabang', 'Baliwag', 'Bulacan', '2026-05-18 10:26:42', '2026-05-18 10:26:42'),
(14, 'Tibag', 'Baliwag', 'Bulacan', '2026-05-18 10:26:42', '2026-05-18 10:26:42'),
(15, 'Subic', 'Baliwag', 'Bulacan', '2026-05-18 10:26:42', '2026-05-18 10:26:42'),
(16, 'San Roque', 'Baliwag', 'Bulacan', '2026-05-18 10:26:42', '2026-05-18 10:26:42'),
(17, 'Paitan', 'Baliwag', 'Bulacan', '2026-05-18 10:26:42', '2026-05-18 10:26:42'),
(18, 'Sto. Cristo', 'Baliwag', 'Bulacan', '2026-05-18 10:26:42', '2026-05-18 10:26:42'),
(19, 'Hinukay', 'Baliwag', 'Bulacan', '2026-05-18 10:26:42', '2026-05-18 10:26:42'),
(20, 'Sto. Niño', 'Baliwag', 'Bulacan', '2026-05-18 10:26:42', '2026-05-18 10:26:42'),
(21, 'Tilapayong', 'Baliwag', 'Bulacan', '2026-05-18 10:26:42', '2026-05-18 10:26:42'),
(22, 'Concepcion', 'Baliwag', 'Bulacan', '2026-05-18 10:26:42', '2026-05-18 10:26:42'),
(23, 'Barangca', 'Baliwag', 'Bulacan', '2026-05-18 10:26:42', '2026-05-18 10:26:42'),
(24, 'Piel', 'Baliwag', 'Bulacan', '2026-05-18 10:26:42', '2026-05-18 10:26:42'),
(25, 'Catulinan', 'Baliwag', 'Bulacan', '2026-05-18 10:26:42', '2026-05-18 10:26:42'),
(26, 'Calantipay', 'Baliwag', 'Bulacan', '2026-05-18 10:26:42', '2026-05-18 10:26:42'),
(27, 'Sta. Barbara', 'Baliwag', 'Bulacan', '2026-05-18 10:26:42', '2026-05-18 10:26:42'),
(28, 'Sabang', 'Baliwag', 'Bulacan', '2026-05-18 10:26:42', '2026-05-18 10:26:42'),
(29, 'Matangtubig', 'Baliwag', 'Bulacan', '2026-05-18 10:26:42', '2026-05-18 10:26:42');

-- --------------------------------------------------------

--
-- Table structure for table `chatbot_consultation_logs`
--

CREATE TABLE `chatbot_consultation_logs` (
  `id` int NOT NULL,
  `pet_type` varchar(40) NOT NULL,
  `age_group` varchar(40) DEFAULT NULL,
  `symptoms_json` json NOT NULL,
  `duration` varchar(40) NOT NULL,
  `severity` varchar(40) NOT NULL,
  `barangay_id` int DEFAULT NULL,
  `matched_rule_id` int DEFAULT NULL,
  `recommended_action` varchar(40) NOT NULL,
  `recommendation` text NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

--
-- Dumping data for table `chatbot_consultation_logs`
--

INSERT INTO `chatbot_consultation_logs` (`id`, `pet_type`, `age_group`, `symptoms_json`, `duration`, `severity`, `barangay_id`, `matched_rule_id`, `recommended_action`, `recommendation`, `created_at`) VALUES
(1, 'Dog', 'Not sure', '[\"Coughing\", \"Loss of Appetite\", \"Wounds\", \"Seizures\"]', '1-3 Days', 'Active', 8, 7, 'book_appointment', 'Recommended action: Book appointment\n\nGently keep the wound clean and prevent licking. Visit the clinic for proper cleaning, medication, and wound assessment.', '2026-05-27 07:37:49'),
(2, 'Dog', 'Adult', '[\"Vomiting\", \"Diarrhea\"]', 'Less Than 24 Hours', 'Active', 1, 1, 'monitor_24hrs', 'Recommended action: Monitor 24hrs\n\nHome care:\nProvide clean water, offer small bland meals, and observe energy level.\n\nBook an appointment if vomiting or diarrhea continues, blood appears, or your pet becomes weak.', '2026-05-27 07:41:58'),
(3, 'Dog', 'Baby', '[\"Vomiting\"]', '1-3 Days', 'Active', 8, 9, 'monitor_24hrs', 'nice ubo', '2026-05-27 07:45:33'),
(4, 'Dog', 'Baby', '[\"Vomiting\"]', '1-3 Days', 'Active', 8, 9, 'monitor_24hrs', 'nice ubo', '2026-05-27 07:47:12'),
(5, 'Dog', 'Young', '[\"Vomiting\"]', '1-3 Days', 'Active', 8, 9, 'monitor_24hrs', 'nice ubo', '2026-05-27 08:00:03'),
(6, 'Dog', 'Baby', '[\"Vomiting\"]', '1-3 Days', 'Active', 8, 9, 'monitor_24hrs', 'nice ubo', '2026-05-27 08:03:06'),
(7, 'Dog', 'Young', '[\"Vomiting\"]', '1-3 Days', 'Active', 8, 9, 'monitor_24hrs', 'nice ubo', '2026-05-27 08:06:07'),
(8, 'Dog', 'Baby', '[\"Vomiting\"]', '1-3 Days', 'Active', 8, 9, 'monitor_24hrs', 'nice ubo', '2026-05-27 08:09:15'),
(9, 'Dog', 'Baby', '[\"Fever\"]', '1-3 Days', 'Active', 8, 1, 'monitor_24hrs', 'Recommended action: Monitor 24hrs\n\nHome care:\nProvide clean water, offer small bland meals, and observe energy level.\n\nBook an appointment if vomiting or diarrhea continues, blood appears, or your pet becomes weak.', '2026-06-02 08:19:20');

-- --------------------------------------------------------

--
-- Table structure for table `chatbot_consultation_rules`
--

CREATE TABLE `chatbot_consultation_rules` (
  `id` int NOT NULL,
  `pet_type` varchar(40) NOT NULL,
  `age_group` varchar(40) DEFAULT NULL,
  `symptoms_json` json NOT NULL,
  `duration` varchar(40) NOT NULL,
  `severity` varchar(40) NOT NULL DEFAULT 'Active',
  `barangay_id` int DEFAULT NULL,
  `condition_title` varchar(160) NOT NULL,
  `recommendation` text NOT NULL,
  `action_type` enum('home_care','monitor_24hrs','book_appointment','emergency_visit') NOT NULL DEFAULT 'monitor_24hrs',
  `status` enum('active','inactive') NOT NULL DEFAULT 'active',
  `usage_count` int NOT NULL DEFAULT '0',
  `created_by_user_id` int DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

--
-- Dumping data for table `chatbot_consultation_rules`
--

INSERT INTO `chatbot_consultation_rules` (`id`, `pet_type`, `age_group`, `symptoms_json`, `duration`, `severity`, `barangay_id`, `condition_title`, `recommendation`, `action_type`, `status`, `usage_count`, `created_by_user_id`, `created_at`, `updated_at`) VALUES
(1, 'Dog', 'Any', '[\"Vomiting\", \"Diarrhea\"]', 'Less Than 24 Hours', 'Active', NULL, 'Digestive Upset', 'Recommended action: Monitor 24hrs\n\nHome care:\nProvide clean water, offer small bland meals, and observe energy level.\n\nBook an appointment if vomiting or diarrhea continues, blood appears, or your pet becomes weak.', 'monitor_24hrs', 'active', 2, NULL, '2026-05-27 07:26:24', '2026-06-02 08:19:20'),
(3, 'Cat', 'Any', '[\"Loss of Appetite\"]', '1-3 Days', 'Moderate', NULL, 'Reduced Appetite', 'Recommended action: Book appointment\n\nCats that do not eat for more than a day should be checked. Keep water available and avoid forcing food.', 'book_appointment', 'active', 0, NULL, '2026-05-27 07:26:24', '2026-05-27 07:26:24'),
(5, 'Dog', 'Any', '[\"Seizures\"]', 'Less Than 24 Hours', 'Critical', NULL, 'Seizure Episode', 'Recommended action: Emergency visit\n\nKeep your pet away from stairs or sharp objects, do not put your hand in the mouth, and bring the pet to the clinic immediately.', 'emergency_visit', 'active', 0, NULL, '2026-05-27 07:26:24', '2026-05-27 07:26:24'),
(7, 'Other', 'Any', '[\"Wounds\"]', '1-3 Days', 'Moderate', NULL, 'Open Wound or Injury', 'Recommended action: Book appointment\n\nGently keep the wound clean and prevent licking. Visit the clinic for proper cleaning, medication, and wound assessment.', 'book_appointment', 'active', 1, NULL, '2026-05-27 07:26:24', '2026-05-27 07:37:49');

-- --------------------------------------------------------

--
-- Table structure for table `chatbot_inquiry_logs`
--

CREATE TABLE `chatbot_inquiry_logs` (
  `id` int NOT NULL,
  `inquiry_rule_id` int DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

--
-- Dumping data for table `chatbot_inquiry_logs`
--

INSERT INTO `chatbot_inquiry_logs` (`id`, `inquiry_rule_id`, `created_at`) VALUES
(1, 10, '2026-05-27 08:26:41'),
(2, 10, '2026-05-27 08:35:18');

-- --------------------------------------------------------

--
-- Table structure for table `chatbot_inquiry_rules`
--

CREATE TABLE `chatbot_inquiry_rules` (
  `id` int NOT NULL,
  `name` varchar(120) NOT NULL,
  `icon` varchar(60) NOT NULL DEFAULT 'chat',
  `response` text NOT NULL,
  `action_type` varchar(30) NOT NULL DEFAULT 'no-action',
  `action_label` varchar(120) DEFAULT NULL,
  `redirect_page` varchar(160) DEFAULT NULL,
  `button_label` varchar(120) DEFAULT NULL,
  `status` enum('active','inactive') NOT NULL DEFAULT 'active',
  `usage_count` int NOT NULL DEFAULT '0',
  `created_by_user_id` int DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

--
-- Dumping data for table `chatbot_inquiry_rules`
--

INSERT INTO `chatbot_inquiry_rules` (`id`, `name`, `icon`, `response`, `action_type`, `action_label`, `redirect_page`, `button_label`, `status`, `usage_count`, `created_by_user_id`, `created_at`, `updated_at`) VALUES
(1, 'Clinic Schedule', 'clock', 'Monday - Friday\n8:00 AM - 5:00 PM\n\nSaturday\n8:00 AM - 12:00 PM by appointment\n\nSunday\nClosed', 'no-action', 'No action', '', '', 'active', 0, NULL, '2026-05-27 07:26:24', '2026-05-27 07:26:24'),
(3, 'Vaccination Requirements', 'syringe', 'Before vaccination, your pet should be healthy and free from fever, vomiting, diarrhea, or severe weakness.\n\nPlease bring any previous vaccination record and keep your pet secured with a leash or carrier.', 'no-action', 'No action', '', '', 'active', 0, NULL, '2026-05-27 07:26:24', '2026-05-27 07:26:24'),
(5, 'Book Appointment', 'clipboard', 'You can book an appointment with our veterinary team on the appointment page.', 'redirect', 'Book Appointment', 'book-appointment.html', 'Book Appointment', 'active', 0, NULL, '2026-05-27 07:26:24', '2026-05-27 07:26:24'),
(7, 'Lost and Found Procedure', 'link', 'To report a lost or found pet, open the Lost & Found page, submit a clear photo, complete the pet details, and provide the last known barangay/location.\n\nOur team reviews reports and helps match possible owners.', 'redirect', 'Open Lost & Found', 'lost-found.html', 'Open Lost & Found', 'active', 0, NULL, '2026-05-27 07:26:24', '2026-05-27 07:26:24');

-- --------------------------------------------------------

--
-- Table structure for table `contact_verifications`
--

CREATE TABLE `contact_verifications` (
  `id` int UNSIGNED NOT NULL,
  `user_id` int UNSIGNED DEFAULT NULL,
  `contact_type` enum('email','phone') NOT NULL,
  `contact_value` varchar(255) NOT NULL,
  `otp_code` char(6) NOT NULL,
  `expires_at` datetime NOT NULL,
  `verified_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

--
-- Dumping data for table `contact_verifications`
--

INSERT INTO `contact_verifications` (`id`, `user_id`, `contact_type`, `contact_value`, `otp_code`, `expires_at`, `verified_at`, `created_at`) VALUES
(14, NULL, 'email', 'kiritovillaster@gmail.com', '200716', '2026-06-09 19:27:40', '2026-06-10 01:18:11', '2026-06-10 01:17:40'),
(17, NULL, 'email', 'kiritovillaster@gmail.com', '603616', '2026-06-09 19:34:52', '2026-06-10 01:25:10', '2026-06-10 01:24:52'),
(18, NULL, 'phone', '+639959210640', '562566', '2026-06-09 19:35:11', NULL, '2026-06-10 01:25:11'),
(19, NULL, 'email', 'kiritovillaster@gmail.com', '127091', '2026-06-09 19:54:45', '2026-06-10 01:46:47', '2026-06-10 01:44:45'),
(20, NULL, 'email', 'markdeppaa@gmail.com', '034294', '2026-06-09 20:51:26', '2026-06-10 02:41:53', '2026-06-10 02:41:26');

-- --------------------------------------------------------

--
-- Table structure for table `lost_found_claims`
--

CREATE TABLE `lost_found_claims` (
  `id` int NOT NULL,
  `case_number` varchar(40) NOT NULL,
  `report_id` int NOT NULL,
  `claimant_user_id` int DEFAULT NULL,
  `status` enum('pending','approved','rejected','resolved') NOT NULL DEFAULT 'pending',
  `claimant_name` varchar(150) DEFAULT NULL,
  `claimant_phone` varchar(40) DEFAULT NULL,
  `claimant_email` varchar(150) DEFAULT NULL,
  `proof_type` varchar(80) DEFAULT NULL,
  `proof_notes` text,
  `proof_file_path` varchar(255) DEFAULT NULL,
  `reviewed_by_user_id` int DEFAULT NULL,
  `reviewed_at` datetime DEFAULT NULL,
  `review_notes` text,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

--
-- Dumping data for table `lost_found_claims`
--

INSERT INTO `lost_found_claims` (`id`, `case_number`, `report_id`, `claimant_user_id`, `status`, `claimant_name`, `claimant_phone`, `claimant_email`, `proof_type`, `proof_notes`, `proof_file_path`, `reviewed_by_user_id`, `reviewed_at`, `review_notes`, `created_at`, `updated_at`) VALUES
(1, 'CLM-20260521-72EA2B', 9, NULL, 'resolved', 'Mark Ivan Jalova Villaster', '+639959210640', NULL, 'Photo Evidence', NULL, '/Final-Backend/backend/uploads/lost_found_claims/lost_found_claims_1779356127_eac9d66199da.jpg', NULL, '2026-05-25 14:42:32', '', '2026-05-21 09:35:27', '2026-05-25 06:42:32'),
(2, 'CLM-20260524-7B6153', 17, 3, 'rejected', 'Mark Ivan Jalova Villaster', '+639959210640', NULL, 'Photo Evidence', NULL, '/Final-Backend/backend/uploads/lost_found_claims/lost_found_claims_1779606375_3b37e30ba86d.jpg', NULL, '2026-05-25 14:31:40', '', '2026-05-24 07:06:15', '2026-05-25 06:31:40'),
(3, 'CLM-20260525-D0F0FB', 29, NULL, 'resolved', 'villaster,Mark ivan Jalova.', '+639959210640', NULL, 'Photo Evidence', NULL, '/Final-Backend/backend/uploads/lost_found_claims/lost_found_claims_1779691219_3844da4805c4.jpg', NULL, '2026-05-25 14:40:41', '', '2026-05-25 06:40:19', '2026-05-25 06:40:41');

-- --------------------------------------------------------

--
-- Table structure for table `lost_found_matches`
--

CREATE TABLE `lost_found_matches` (
  `id` int NOT NULL,
  `lost_report_id` int NOT NULL,
  `found_report_id` int DEFAULT NULL,
  `sighting_id` int DEFAULT NULL,
  `confidence` tinyint UNSIGNED NOT NULL DEFAULT '0',
  `reasons_json` longtext,
  `status` enum('suggested','approved','dismissed') NOT NULL DEFAULT 'suggested',
  `reviewed_by_user_id` int DEFAULT NULL,
  `reviewed_at` datetime DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

--
-- Dumping data for table `lost_found_matches`
--

INSERT INTO `lost_found_matches` (`id`, `lost_report_id`, `found_report_id`, `sighting_id`, `confidence`, `reasons_json`, `status`, `reviewed_by_user_id`, `reviewed_at`, `created_at`, `updated_at`) VALUES
(5, 11, 12, NULL, 74, '[\"Same species\",\"Same sex\",\"Same size\",\"Similar color or markings\",\"Within 1 km\",\"Similar photo color profile\",\"Similar image pattern\"]', 'approved', NULL, '2026-05-21 17:40:52', '2026-05-21 09:40:40', '2026-05-21 09:40:52'),
(6, 13, 15, NULL, 76, '[\"Similar breed\",\"Same sex\",\"Same size\",\"Similar color or markings\",\"Same barangay\",\"Similar photo color profile\",\"Similar image pattern\"]', 'dismissed', NULL, '2026-05-24 14:59:34', '2026-05-24 06:58:14', '2026-05-24 06:59:34'),
(7, 14, 15, NULL, 100, '[\"Same species\",\"Similar breed\",\"Same sex\",\"Same size\",\"Similar color or markings\",\"Same barangay\",\"Similar photo color profile\",\"Similar image pattern\"]', 'approved', NULL, '2026-05-24 14:59:32', '2026-05-24 06:58:14', '2026-05-24 06:59:32'),
(8, 16, 17, NULL, 91, '[\"Same species\",\"Similar breed\",\"Same sex\",\"Same size\",\"Similar color or markings\",\"Same barangay\",\"Similar photo color profile\",\"Similar image pattern\"]', 'approved', NULL, '2026-05-24 15:08:36', '2026-05-24 07:03:08', '2026-05-24 07:08:36'),
(9, 16, NULL, 1, 70, '[\"Same species\",\"Similar breed\",\"Same sex\",\"Same size\",\"Same barangay\"]', 'dismissed', NULL, '2026-05-24 15:08:43', '2026-05-24 07:07:49', '2026-05-24 07:08:43'),
(10, 18, NULL, 1, 70, '[\"Same species\",\"Similar breed\",\"Same sex\",\"Same size\",\"Same barangay\"]', 'dismissed', NULL, '2026-05-24 17:13:21', '2026-05-24 07:23:10', '2026-05-24 09:13:21'),
(11, 19, NULL, 1, 70, '[\"Same species\",\"Similar breed\",\"Same sex\",\"Same size\",\"Same barangay\"]', 'dismissed', NULL, '2026-05-25 14:34:33', '2026-05-24 08:54:11', '2026-05-25 06:34:33'),
(12, 20, NULL, 1, 62, '[\"Same species\",\"Similar breed\",\"Same sex\",\"Same size\",\"Same barangay\"]', 'dismissed', NULL, '2026-05-25 14:34:46', '2026-05-25 03:22:22', '2026-05-25 06:34:46'),
(13, 20, 21, NULL, 65, '[\"Same species\",\"Similar breed\",\"Same sex\",\"Same size\",\"Within 1 km\"]', 'dismissed', NULL, '2026-05-25 14:34:35', '2026-05-25 03:29:11', '2026-05-25 06:34:35'),
(14, 18, 22, NULL, 57, '[\"Same species\",\"Same sex\",\"Same size\",\"Similar color or markings\",\"Within 1 km\"]', 'dismissed', NULL, '2026-05-25 14:34:41', '2026-05-25 03:30:38', '2026-05-25 06:34:41'),
(15, 20, 22, NULL, 45, '[\"Same species\",\"Same sex\",\"Within 1 km\"]', 'dismissed', NULL, '2026-05-25 14:34:48', '2026-05-25 03:30:38', '2026-05-25 06:34:48'),
(16, 20, 23, NULL, 80, '[\"Same species\",\"Similar breed\",\"Same sex\",\"Same size\",\"Similar color or markings\",\"Same barangay\"]', 'dismissed', NULL, '2026-05-25 14:34:32', '2026-05-25 03:40:31', '2026-05-25 06:34:32'),
(17, 24, 21, NULL, 64, '[\"Same species\",\"Similar breed\",\"Same sex\",\"Same size\",\"Within 1 km\"]', 'dismissed', NULL, '2026-05-25 14:34:36', '2026-05-25 03:40:57', '2026-05-25 06:34:36'),
(18, 24, NULL, 1, 62, '[\"Same species\",\"Similar breed\",\"Same sex\",\"Same size\",\"Same barangay\"]', 'dismissed', NULL, '2026-05-25 14:34:39', '2026-05-25 03:40:57', '2026-05-25 06:34:39'),
(19, 20, 25, NULL, 50, '[\"Same sex\",\"Same size\",\"Similar color or markings\",\"Same barangay\"]', 'suggested', NULL, NULL, '2026-05-25 03:49:51', '2026-05-25 03:50:05'),
(20, 26, 22, NULL, 56, '[\"Same species\",\"Same sex\",\"Same size\",\"Within 1 km\"]', 'dismissed', NULL, '2026-05-25 14:34:45', '2026-05-25 06:33:04', '2026-05-25 06:34:45'),
(21, 27, 25, NULL, 62, '[\"Same species\",\"Similar breed\",\"Same sex\",\"Similar color or markings\",\"Same barangay\"]', 'dismissed', NULL, '2026-05-25 14:36:17', '2026-05-25 06:33:47', '2026-05-25 06:36:17'),
(22, 28, 25, NULL, 72, '[\"Same species\",\"Similar breed\",\"Same sex\",\"Same size\",\"Similar color or markings\",\"Same barangay\"]', 'suggested', NULL, NULL, '2026-05-25 06:36:53', '2026-05-25 06:36:58'),
(23, 28, 29, NULL, 84, '[\"Same species\",\"Similar breed\",\"Same sex\",\"Same size\",\"Similar color or markings\",\"Same barangay\"]', 'suggested', NULL, NULL, '2026-05-25 06:39:26', '2026-05-25 06:39:33'),
(24, 18, NULL, 2, 65, '[\"Same species\",\"Similar breed\",\"Same sex\",\"Same size\",\"Similar color or markings\"]', 'suggested', NULL, NULL, '2026-05-25 06:45:00', '2026-05-25 07:31:44'),
(25, 20, NULL, 2, 48, '[\"Same species\",\"Similar breed\",\"Same sex\",\"Same size\"]', 'suggested', NULL, NULL, '2026-05-25 06:45:00', '2026-05-25 07:31:44'),
(26, 28, NULL, 2, 53, '[\"Same species\",\"Similar breed\",\"Same sex\",\"Same size\",\"Similar color or markings\"]', 'suggested', NULL, NULL, '2026-05-25 06:45:00', '2026-05-25 07:31:44'),
(27, 18, NULL, 3, 65, '[\"Same species\",\"Similar breed\",\"Same sex\",\"Same size\",\"Within 1 km\"]', 'suggested', NULL, NULL, '2026-05-25 07:30:44', '2026-05-25 07:30:44'),
(28, 20, NULL, 3, 66, '[\"Same species\",\"Similar breed\",\"Same sex\",\"Same size\",\"Within 1 km\"]', 'suggested', NULL, NULL, '2026-05-25 07:30:44', '2026-05-25 07:30:44'),
(29, 28, NULL, 3, 66, '[\"Same species\",\"Similar breed\",\"Same sex\",\"Same size\",\"Within 1 km\"]', 'suggested', NULL, NULL, '2026-05-25 07:30:44', '2026-05-25 07:30:44'),
(30, 18, NULL, 4, 80, '[\"Same species\",\"Similar breed\",\"Same sex\",\"Same size\",\"Similar color or markings\",\"Same barangay\"]', 'suggested', NULL, NULL, '2026-05-25 07:31:44', '2026-05-25 07:31:44'),
(31, 20, NULL, 4, 62, '[\"Same species\",\"Similar breed\",\"Same sex\",\"Same size\",\"Same barangay\"]', 'suggested', NULL, NULL, '2026-05-25 07:31:44', '2026-05-25 07:31:44'),
(32, 28, NULL, 4, 67, '[\"Same species\",\"Similar breed\",\"Same sex\",\"Same size\",\"Similar color or markings\",\"Same barangay\"]', 'suggested', NULL, NULL, '2026-05-25 07:31:44', '2026-05-25 07:31:44'),
(33, 30, 22, NULL, 56, '[\"Same species\",\"Same sex\",\"Same size\",\"Within 1 km\"]', 'suggested', NULL, NULL, '2026-05-25 07:36:48', '2026-05-25 07:36:48'),
(34, 30, NULL, 2, 53, '[\"Same species\",\"Similar breed\",\"Same sex\",\"Same size\",\"Similar color or markings\"]', 'suggested', NULL, NULL, '2026-05-25 07:36:48', '2026-05-25 07:36:48');

-- --------------------------------------------------------

--
-- Table structure for table `lost_found_reports`
--

CREATE TABLE `lost_found_reports` (
  `id` int NOT NULL,
  `case_number` varchar(40) NOT NULL,
  `report_type` enum('lost','found') NOT NULL,
  `status` enum('pending','active','resolved','rejected') NOT NULL DEFAULT 'pending',
  `source` enum('owner','vet','admin','public') NOT NULL DEFAULT 'owner',
  `owner_id` int DEFAULT NULL,
  `pet_name` varchar(120) DEFAULT NULL,
  `species` varchar(60) DEFAULT NULL,
  `breed` varchar(120) DEFAULT NULL,
  `sex` varchar(30) DEFAULT NULL,
  `size` varchar(60) DEFAULT NULL,
  `color_markings` text,
  `notes` text,
  `barangay_id` int DEFAULT NULL,
  `barangay_name` varchar(120) DEFAULT NULL,
  `location_text` varchar(255) DEFAULT NULL,
  `latitude` decimal(10,7) DEFAULT NULL,
  `longitude` decimal(10,7) DEFAULT NULL,
  `incident_date` date DEFAULT NULL,
  `incident_time` time DEFAULT NULL,
  `photo_path` varchar(255) DEFAULT NULL,
  `image_features` longtext,
  `contact_name` varchar(150) DEFAULT NULL,
  `contact_phone` varchar(40) DEFAULT NULL,
  `contact_email` varchar(150) DEFAULT NULL,
  `reviewed_by_user_id` int DEFAULT NULL,
  `review_notes` text,
  `reviewed_at` datetime DEFAULT NULL,
  `resolved_at` datetime DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

--
-- Dumping data for table `lost_found_reports`
--

INSERT INTO `lost_found_reports` (`id`, `case_number`, `report_type`, `status`, `source`, `owner_id`, `pet_name`, `species`, `breed`, `sex`, `size`, `color_markings`, `notes`, `barangay_id`, `barangay_name`, `location_text`, `latitude`, `longitude`, `incident_date`, `incident_time`, `photo_path`, `image_features`, `contact_name`, `contact_phone`, `contact_email`, `reviewed_by_user_id`, `review_notes`, `reviewed_at`, `resolved_at`, `created_at`, `updated_at`) VALUES
(7, 'FP-20260521-A64B88', 'found', 'resolved', 'owner', NULL, NULL, 'Feline', 'SDA', 'Male', 'Small (Under 10kg)', 'ASD', 'ASDASD', NULL, 'Calasag', NULL, NULL, NULL, '2026-05-21', NULL, '/Final-Backend/backend/uploads/lost_found/lost_found_1779355627_e8e427efe582.jpg', '{\"sha1\":\"d54615897034567a012c1cf041e5ad5d11e8960f\",\"width\":720,\"height\":730,\"mime\":\"image\\/jpeg\",\"engine\":\"metadata\"}', 'Mark Ivan Jalova Villaster', '09959210640', 'kiritovillaster@gmail.com', NULL, '', '2026-05-21 17:43:59', '2026-05-21 17:43:59', '2026-05-21 09:27:07', '2026-05-21 09:43:59'),
(8, 'LP-20260521-E6F1CE', 'lost', 'resolved', 'vet', NULL, 'Copper', 'Dog', 'Golden Retriever', 'Male', 'Small (Under 10kg)', 'sadas', 'ASD', 26, 'Calantipay', NULL, 14.9577000, 120.9055000, '2026-05-22', '14:22:00', '/Final-Backend/backend/uploads/lost_found/lost_found_1779355740_6c2b2f19768f.jpg', '{\"sha1\":\"d54615897034567a012c1cf041e5ad5d11e8960f\",\"width\":720,\"height\":730,\"mime\":\"image\\/jpeg\",\"engine\":\"metadata\"}', 'Mark Ivan Jalova Villaster', '09959210640', 'kiritovillaster@gmail.com', NULL, '', '2026-05-21 17:29:27', '2026-05-21 17:29:27', '2026-05-21 09:29:00', '2026-05-21 09:29:27'),
(9, 'FP-20260521-BC6C8B', 'found', 'resolved', 'vet', NULL, 'Copper', 'Cat', 'Golden Retriever', 'Male', 'Small (Under 10kg)', 'sadas', 'ASDASD', 4, 'San Jose', NULL, 14.9542000, 120.9099000, '2026-05-22', NULL, '/Final-Backend/backend/uploads/lost_found/lost_found_1779356103_595007f251cf.jpg', '{\"sha1\":\"d54615897034567a012c1cf041e5ad5d11e8960f\",\"width\":720,\"height\":730,\"mime\":\"image\\/jpeg\",\"engine\":\"metadata\"}', 'Mark Ivan Jalova Villaster', '09959210640', 'kiritovillaster@gmail.com', NULL, NULL, NULL, '2026-05-25 14:42:32', '2026-05-21 09:35:03', '2026-05-25 06:42:32'),
(11, 'LP-20260521-BF025A', 'lost', 'resolved', 'owner', NULL, 'IDOL', 'Dog', 'chuwwaa', 'Male', 'Small (Under 10kg)', 'tie', 'ASD', 8, 'Bagong Nayon', NULL, 14.9577000, 120.9055000, '2026-05-22', NULL, '/Final-Backend/backend/uploads/lost_found/lost_found_1779356405_f394e3d3e30e.jpg', '{\"sha1\":\"d54615897034567a012c1cf041e5ad5d11e8960f\",\"engine\":\"python\",\"width\":720,\"height\":730,\"mime\":\"image\\/jpeg\",\"avg_rgb\":[122,89,57],\"brightness_hash\":\"000000000000000001110000000011111000000011111000000011111100000011111110000011111110000111111011000000111001000000111100011100111100111111111100\",\"color_histogram\":[0.224854,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.163574,0,0,0,0.12085,0.029541,0,0,0,0,0,0,0,0,0,0,0.000488,0,0,0,0.088623,0.07959,0,0,0.000732,0.062012,0.00708,0,0,0,0.000244,0,0,0,0,0,0,0.000732,0,0,0,0.198486,0.007568,0,0,0,0.013916,0.001709]}', 'Mark Ivan Jalova Villaster', '09959210640', 'kiritovillaster@gmail.com', NULL, NULL, NULL, '2026-05-21 17:40:52', '2026-05-21 09:40:06', '2026-05-21 09:40:52'),
(12, 'FP-20260521-C31998', 'found', 'resolved', 'vet', NULL, 'NA', 'Dog', 'Golden Retriever', 'Male', 'Small (Under 10kg)', 'sadas', 'ASD', 23, 'Barangca', NULL, 14.9577000, 120.9055000, '2026-05-21', '14:22:00', '/Final-Backend/backend/uploads/lost_found/lost_found_1779356440_0d478e18c15f.jpg', '{\"sha1\":\"d54615897034567a012c1cf041e5ad5d11e8960f\",\"engine\":\"python\",\"width\":720,\"height\":730,\"mime\":\"image\\/jpeg\",\"avg_rgb\":[122,89,57],\"brightness_hash\":\"000000000000000001110000000011111000000011111000000011111100000011111110000011111110000111111011000000111001000000111100011100111100111111111100\",\"color_histogram\":[0.224854,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.163574,0,0,0,0.12085,0.029541,0,0,0,0,0,0,0,0,0,0,0.000488,0,0,0,0.088623,0.07959,0,0,0.000732,0.062012,0.00708,0,0,0,0.000244,0,0,0,0,0,0,0.000732,0,0,0,0.198486,0.007568,0,0,0,0.013916,0.001709]}', 'Mark Ivan Jalova Villaster', '09959210640', 'kiritovillaster@gmail.com', NULL, NULL, NULL, '2026-05-21 17:40:52', '2026-05-21 09:40:40', '2026-05-21 09:40:52'),
(13, 'LP-20260524-78310A', 'lost', 'resolved', 'owner', 3, 'IDOL', 'Cat', 'chuwwaa', 'Male', 'Small (Under 10kg)', 'tie', 'nice', 13, 'Makinabang', NULL, 14.9584000, 120.9001000, '2026-05-22', NULL, '/Final-Backend/backend/uploads/lost_found/lost_found_1779598896_4e9dd02ef085.jpg', '{\"sha1\":\"d54615897034567a012c1cf041e5ad5d11e8960f\",\"engine\":\"python\",\"width\":720,\"height\":730,\"mime\":\"image\\/jpeg\",\"avg_rgb\":[122,89,57],\"brightness_hash\":\"000000000000000001110000000011111000000011111000000011111100000011111110000011111110000111111011000000111001000000111100011100111100111111111100\",\"color_histogram\":[0.224854,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.163574,0,0,0,0.12085,0.029541,0,0,0,0,0,0,0,0,0,0,0.000488,0,0,0,0.088623,0.07959,0,0,0.000732,0.062012,0.00708,0,0,0,0.000244,0,0,0,0,0,0,0.000732,0,0,0,0.198486,0.007568,0,0,0,0.013916,0.001709]}', 'Mark ivan Jalova. villaster', '09959210640', 'markdeppaa@gmail.com', NULL, '', '2026-05-24 14:59:38', '2026-05-24 14:59:38', '2026-05-24 05:01:36', '2026-05-24 06:59:38'),
(14, 'LP-20260524-9DE5D0', 'lost', 'resolved', 'vet', NULL, 'IDOL', 'Dog', 'chuwwaa', 'Male', 'Small (Under 10kg)', 'tie', 'asd', 13, 'Makinabang', NULL, 14.9584000, 120.9001000, '2026-05-23', '14:22:00', '/Final-Backend/backend/uploads/lost_found/lost_found_1779605847_a0a972bafe2d.jpg', '{\"sha1\":\"d54615897034567a012c1cf041e5ad5d11e8960f\",\"engine\":\"python\",\"width\":720,\"height\":730,\"mime\":\"image\\/jpeg\",\"avg_rgb\":[122,89,57],\"brightness_hash\":\"000000000000000001110000000011111000000011111000000011111100000011111110000011111110000111111011000000111001000000111100011100111100111111111100\",\"color_histogram\":[0.224854,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.163574,0,0,0,0.12085,0.029541,0,0,0,0,0,0,0,0,0,0,0.000488,0,0,0,0.088623,0.07959,0,0,0.000732,0.062012,0.00708,0,0,0,0.000244,0,0,0,0,0,0,0.000732,0,0,0,0.198486,0.007568,0,0,0,0.013916,0.001709]}', 'Mark ivan Jalova. villaster', '09959210640', 'markdeppaa@gmail.com', NULL, NULL, NULL, '2026-05-24 14:59:32', '2026-05-24 06:57:28', '2026-05-24 06:59:32'),
(15, 'FP-20260524-63A789', 'found', 'resolved', 'vet', NULL, 'IDOL', 'Dog', 'chuwwaa', 'Male', 'Small (Under 10kg)', 'tie', 'asd', 13, 'Makinabang', NULL, 14.9584000, 120.9001000, '2026-05-23', '14:22:00', '/Final-Backend/backend/uploads/lost_found/lost_found_1779605893_8e278885c2f9.jpg', '{\"sha1\":\"d54615897034567a012c1cf041e5ad5d11e8960f\",\"engine\":\"python\",\"width\":720,\"height\":730,\"mime\":\"image\\/jpeg\",\"avg_rgb\":[122,89,57],\"brightness_hash\":\"000000000000000001110000000011111000000011111000000011111100000011111110000011111110000111111011000000111001000000111100011100111100111111111100\",\"color_histogram\":[0.224854,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.163574,0,0,0,0.12085,0.029541,0,0,0,0,0,0,0,0,0,0,0.000488,0,0,0,0.088623,0.07959,0,0,0.000732,0.062012,0.00708,0,0,0,0.000244,0,0,0,0,0,0,0.000732,0,0,0,0.198486,0.007568,0,0,0,0.013916,0.001709]}', 'Mark ivan Jalova. villaster', '09959210640', 'markdeppaa@gmail.com', NULL, '', '2026-05-24 14:59:11', '2026-05-24 14:59:32', '2026-05-24 06:58:14', '2026-05-24 06:59:32'),
(16, 'LP-20260524-0B99DF', 'lost', 'resolved', 'owner', 3, 'sohee', 'Dog', 'Golden retriever', 'Male', 'Small (Under 10kg)', 'ASD', 'brown mark', 8, 'Bagong Nayon', NULL, 14.9577000, 120.9055000, '2026-05-24', NULL, '/Final-Backend/backend/uploads/lost_found/lost_found_1779606101_af0745205e61.jpg', '{\"sha1\":\"ebc1416fb68739ee63457f4e5e34c02f29fe44a4\",\"engine\":\"python\",\"width\":736,\"height\":702,\"mime\":\"image\\/jpeg\",\"avg_rgb\":[182,183,190],\"brightness_hash\":\"111111111111111100011111111100001111111110000111111000000111111000000111111110000111111100000111111100000111111100001111111100001111111110011111\",\"color_histogram\":[0.046387,0.011719,0,0,0,0.039307,0,0,0,0,0,0,0,0,0,0,0.003906,0.000977,0,0,0.002441,0.074463,0.01123,0,0,0,0.005127,0,0,0,0,0,0,0,0,0,0,0.033691,0,0,0,0.016113,0.049561,0.003418,0,0,0,0.005127,0,0,0,0,0,0,0,0,0,0,0.02002,0,0,0,0.006592,0.669922]}', 'Mark ivan Jalova. villaster', '999224422', 'markdeppaa@gmail.com', NULL, '', '2026-05-24 15:02:03', '2026-05-24 15:08:36', '2026-05-24 07:01:41', '2026-05-24 07:08:36'),
(17, 'FP-20260524-35A864', 'found', 'resolved', 'vet', NULL, 'NA', 'Dog', 'Golden Retriever', 'Male', 'Small (Under 10kg)', 'COLOR BROWN', 'ASD', 8, 'Bagong Nayon', NULL, 14.9577000, 120.9055000, '2026-05-24', '14:22:00', '/Final-Backend/backend/uploads/lost_found/lost_found_1779606188_f6fba28a2bc7.jpg', '{\"sha1\":\"ebc1416fb68739ee63457f4e5e34c02f29fe44a4\",\"engine\":\"python\",\"width\":736,\"height\":702,\"mime\":\"image\\/jpeg\",\"avg_rgb\":[182,183,190],\"brightness_hash\":\"111111111111111100011111111100001111111110000111111000000111111000000111111110000111111100000111111100000111111100001111111100001111111110011111\",\"color_histogram\":[0.046387,0.011719,0,0,0,0.039307,0,0,0,0,0,0,0,0,0,0,0.003906,0.000977,0,0,0.002441,0.074463,0.01123,0,0,0,0.005127,0,0,0,0,0,0,0,0,0,0,0.033691,0,0,0,0.016113,0.049561,0.003418,0,0,0,0.005127,0,0,0,0,0,0,0,0,0,0,0.02002,0,0,0,0.006592,0.669922]}', 'Mark Ivan Jalova Villaster', '09959210640', 'kiritovillaster@gmail.com', NULL, NULL, NULL, '2026-05-25 14:31:36', '2026-05-24 07:03:08', '2026-05-25 06:31:36'),
(18, 'LP-20260524-0C8AFE', 'lost', 'active', 'owner', 3, 'sohee', 'Dog', 'Golden retriever', 'Male', 'Small (Under 10kg)', 'ASD', 'asd', 8, 'Bagong Nayon', NULL, 14.9577000, 120.9055000, '2026-05-24', NULL, '/Final-Backend/backend/uploads/lost_found/lost_found_1779607390_7319c84c926c.jpg', '{\"sha1\":\"ebc1416fb68739ee63457f4e5e34c02f29fe44a4\",\"engine\":\"python\",\"width\":736,\"height\":702,\"mime\":\"image\\/jpeg\",\"avg_rgb\":[182,183,190],\"brightness_hash\":\"111111111111111100011111111100001111111110000111111000000111111000000111111110000111111100000111111100000111111100001111111100001111111110011111\",\"color_histogram\":[0.046387,0.011719,0,0,0,0.039307,0,0,0,0,0,0,0,0,0,0,0.003906,0.000977,0,0,0.002441,0.074463,0.01123,0,0,0,0.005127,0,0,0,0,0,0,0,0,0,0,0.033691,0,0,0,0.016113,0.049561,0.003418,0,0,0,0.005127,0,0,0,0,0,0,0,0,0,0,0.02002,0,0,0,0.006592,0.669922]}', 'Mark ivan Jalova. villaster', '999224422', 'markdeppaa@gmail.com', NULL, '', '2026-05-24 15:23:18', NULL, '2026-05-24 07:23:10', '2026-05-24 07:23:18'),
(19, 'LP-20260524-EA43A4', 'lost', 'rejected', 'owner', 3, 'IDOL', 'Dog', 'chuwwaa', 'Male', 'Medium (10-25kg)', 'asd', 'asd', 8, 'Bagong Nayon', NULL, 14.9577000, 120.9055000, '2026-05-25', NULL, '/Final-Backend/backend/uploads/lost_found/lost_found_1779612851_c2e1df614832.jpg', '{\"sha1\":\"ebc1416fb68739ee63457f4e5e34c02f29fe44a4\",\"engine\":\"python\",\"width\":736,\"height\":702,\"mime\":\"image\\/jpeg\",\"avg_rgb\":[182,183,190],\"brightness_hash\":\"111111111111111100011111111100001111111110000111111000000111111000000111111110000111111100000111111100000111111100001111111100001111111110011111\",\"color_histogram\":[0.046387,0.011719,0,0,0,0.039307,0,0,0,0,0,0,0,0,0,0,0.003906,0.000977,0,0,0.002441,0.074463,0.01123,0,0,0,0.005127,0,0,0,0,0,0,0,0,0,0,0.033691,0,0,0,0.016113,0.049561,0.003418,0,0,0,0.005127,0,0,0,0,0,0,0,0,0,0,0.02002,0,0,0,0.006592,0.669922]}', 'Mark ivan Jalova. villaster', '09959210640', 'markdeppaa@gmail.com', NULL, '', '2026-05-25 11:19:17', NULL, '2026-05-24 08:54:11', '2026-05-25 03:19:17'),
(20, 'LP-20260525-E28F0C', 'lost', 'active', 'owner', NULL, 'iko', 'Dog', 'aspin', 'Male', 'Medium (10-25kg)', 'brown', 'medyo maharot, asa alfamart kami', 8, 'Bagong Nayon', NULL, 14.9566740, 120.9041360, '2026-05-26', NULL, '/Final-Backend/backend/uploads/lost_found/lost_found_1779679341_bab2716171ea.jpg', '{\"sha1\":\"e5b88b8a734717160a0f57501c5f798a5dc9ca5c\",\"width\":3024,\"height\":4032,\"mime\":\"image\\/jpeg\",\"engine\":\"metadata\"}', 'kizea', '09959210640', 'kizea@gmail.com', NULL, '', '2026-05-25 11:29:23', NULL, '2026-05-25 03:22:22', '2026-05-25 03:29:23'),
(21, 'FP-20260525-A9E546', 'found', 'active', 'vet', NULL, 'na', 'Dog', 'aspin', 'Male', 'Medium (10-25kg)', 'brown', 'nakita namen sa may alfa mart', 23, 'Barangca', NULL, 14.9569080, 120.9041110, '2026-05-25', '11:11:00', '/Final-Backend/backend/uploads/lost_found/lost_found_1779679750_49a7d7d8b9c0.jpg', '{\"sha1\":\"2b78cd656fd4632632f08d57f76abb08dc0c5c43\",\"width\":3072,\"height\":4096,\"mime\":\"image\\/jpeg\",\"engine\":\"metadata\"}', 'Mark ivan Jalova. villaster', '09959210640', 'markdeppaa@gmail.com', NULL, NULL, NULL, NULL, '2026-05-25 03:29:11', '2026-05-25 03:29:11'),
(22, 'FP-20260525-B92174', 'found', 'active', 'vet', NULL, 'na', 'Dog', 'IKO', 'Male', 'Small (Under 10kg)', 'brown', 'ASD', 25, 'Catulinan', NULL, 14.9577000, 120.9055000, '2026-05-25', '14:22:00', '/Final-Backend/backend/uploads/lost_found/lost_found_1779679838_4a6e58c70d0f.jpg', '{\"sha1\":\"632a3e180b5fcc36041b3842b8b5b0f4e99f7139\",\"width\":3072,\"height\":4096,\"mime\":\"image\\/jpeg\",\"engine\":\"metadata\"}', 'Mark ivan Jalova. villaster', '09959210640', 'markdeppaa@gmail.com', NULL, NULL, NULL, NULL, '2026-05-25 03:30:38', '2026-05-25 03:30:38'),
(23, 'FP-20260525-2EFB27', 'found', 'rejected', 'owner', NULL, 'iko', 'Dog', 'aspin', 'Male', 'Medium (10-25kg)', 'brown', 'medyo maharot, asa alfamart kami', 8, 'Bagong Nayon', NULL, 14.9566740, 120.9041360, '2026-05-26', NULL, NULL, NULL, 'kizea', '09959210640', 'kizea@gmail.com', NULL, '', '2026-05-25 11:40:51', NULL, '2026-05-25 03:40:31', '2026-05-25 03:40:51'),
(24, 'LP-20260525-6EA6DA', 'lost', 'resolved', 'owner', NULL, 'iko', 'Dog', 'aspin', 'Male', 'Medium (10-25kg)', 'brown', 'medyo maharot, asa alfamart kami', 8, 'Bagong Nayon', NULL, 14.9566740, 120.9041360, '2026-05-26', NULL, NULL, NULL, 'kizea', '09959210640', 'kizea@gmail.com', NULL, '', '2026-05-25 11:43:36', '2026-05-25 11:43:36', '2026-05-25 03:40:57', '2026-05-25 03:43:36'),
(25, 'FP-20260525-F1B8CD', 'found', 'active', 'owner', NULL, 'iko', 'Cat', 'stray cat', 'Male', 'Medium (10-25kg)', 'black and white', 'medyo maharot, asa alfamart kami', 8, 'Bagong Nayon', NULL, 14.9566740, 120.9041360, '2026-05-26', NULL, '/Final-Backend/backend/uploads/lost_found/lost_found_1779680990_ada31fde7d66.jpg', '{\"sha1\":\"3a44f9d90c6c8899589f3eebeedb7781058a9e9a\",\"width\":3072,\"height\":4096,\"mime\":\"image\\/jpeg\",\"engine\":\"metadata\"}', 'kizea', '09959210640', 'kizea@gmail.com', NULL, '', '2026-05-25 11:50:05', NULL, '2026-05-25 03:49:51', '2026-05-25 03:50:05'),
(26, 'LP-20260525-98BFD3', 'lost', 'resolved', 'owner', NULL, 'IDOL', 'Dog', 'chuwwaa', 'Male', 'Small (Under 10kg)', 'black and white', 'asD', 8, 'Bagong Nayon', NULL, 14.9577000, 120.9055000, '2026-05-25', NULL, '/Final-Backend/backend/uploads/lost_found/lost_found_1779690783_9ee0fff04342.jpg', '{\"sha1\":\"d62e43fc3055d4d663b01f5ceb100c3d3d7eb191\",\"width\":3072,\"height\":4096,\"mime\":\"image\\/jpeg\",\"engine\":\"metadata\"}', 'Mark ivan Jalova. villaster', '09959210640', 'markdeppaa@gmail.com', NULL, '', '2026-05-25 14:36:29', '2026-05-25 14:36:29', '2026-05-25 06:33:04', '2026-05-25 06:36:29'),
(27, 'LP-20260525-581A35', 'lost', 'resolved', 'owner', NULL, 'IDOL', 'Cat', 'stray cat', 'Male', 'Small (Under 10kg)', 'black and white', 'asD', 8, 'Bagong Nayon', NULL, 14.9577000, 120.9055000, '2026-05-25', NULL, '/Final-Backend/backend/uploads/lost_found/lost_found_1779690826_d549aafe52e7.jpg', '{\"sha1\":\"d62e43fc3055d4d663b01f5ceb100c3d3d7eb191\",\"width\":3072,\"height\":4096,\"mime\":\"image\\/jpeg\",\"engine\":\"metadata\"}', 'Mark ivan Jalova. villaster', '09959210640', 'markdeppaa@gmail.com', NULL, '', '2026-05-25 14:36:26', '2026-05-25 14:36:26', '2026-05-25 06:33:47', '2026-05-25 06:36:26'),
(28, 'LP-20260525-53796D', 'lost', 'active', 'owner', NULL, 'IDOL', 'Cat', 'stray cat', 'Male', 'Medium (10-25kg)', 'black and white', 'asD', 8, 'Bagong Nayon', NULL, 14.9577000, 120.9055000, '2026-05-25', NULL, '/Final-Backend/backend/uploads/lost_found/lost_found_1779691012_dbae8b0f7250.jpg', '{\"sha1\":\"d62e43fc3055d4d663b01f5ceb100c3d3d7eb191\",\"width\":3072,\"height\":4096,\"mime\":\"image\\/jpeg\",\"engine\":\"metadata\"}', 'Mark ivan Jalova. villaster', '09959210640', 'markdeppaa@gmail.com', NULL, '', '2026-05-25 14:36:58', NULL, '2026-05-25 06:36:53', '2026-05-25 06:36:58'),
(29, 'FP-20260525-AA3B43', 'found', 'resolved', 'owner', NULL, 'IDOL', 'Cat', 'stray cat', 'Male', 'Medium (10-25kg)', 'black and white', 'asD', 8, 'Bagong Nayon', NULL, 14.9577000, 120.9055000, '2026-05-25', NULL, '/Final-Backend/backend/uploads/lost_found/lost_found_1779691165_dee32c0eaf34.jpg', '{\"sha1\":\"a15d33bfd9349e10bd91cfd6fa78f856b8e71374\",\"width\":3072,\"height\":4096,\"mime\":\"image\\/jpeg\",\"engine\":\"metadata\"}', 'Mark ivan Jalova. villaster', '09959210640', 'markdeppaa@gmail.com', NULL, '', '2026-05-25 14:39:33', '2026-05-25 14:40:41', '2026-05-25 06:39:26', '2026-05-25 06:40:41'),
(30, 'LP-20260525-E4D630', 'lost', 'pending', 'owner', NULL, 'IDOL', 'Dog', 'stray cat', 'Male', 'Small (Under 10kg)', 'black and white', 'asd', 8, 'Bagong Nayon', NULL, 14.9595840, 120.8987820, '2026-05-25', NULL, '/Final-Backend/backend/uploads/lost_found/lost_found_1779694607_74936a655ec7.jpg', '{\"sha1\":\"3a44f9d90c6c8899589f3eebeedb7781058a9e9a\",\"width\":3072,\"height\":4096,\"mime\":\"image\\/jpeg\",\"engine\":\"metadata\"}', 'Mark ivan Jalova. villaster', '09959210640', 'markdeppaa@gmail.com', NULL, NULL, NULL, NULL, '2026-05-25 07:36:48', '2026-05-25 07:36:48');

-- --------------------------------------------------------

--
-- Table structure for table `lost_found_sightings`
--

CREATE TABLE `lost_found_sightings` (
  `id` int NOT NULL,
  `case_number` varchar(40) NOT NULL,
  `report_id` int DEFAULT NULL,
  `submitted_by_user_id` int DEFAULT NULL,
  `status` enum('pending','active','resolved','rejected') NOT NULL DEFAULT 'pending',
  `barangay_id` int DEFAULT NULL,
  `barangay_name` varchar(120) DEFAULT NULL,
  `location_text` varchar(255) DEFAULT NULL,
  `latitude` decimal(10,7) DEFAULT NULL,
  `longitude` decimal(10,7) DEFAULT NULL,
  `sighting_date` date DEFAULT NULL,
  `sighting_time` time DEFAULT NULL,
  `notes` text,
  `photo_path` varchar(255) DEFAULT NULL,
  `image_features` longtext,
  `contact_name` varchar(150) DEFAULT NULL,
  `contact_phone` varchar(40) DEFAULT NULL,
  `contact_email` varchar(150) DEFAULT NULL,
  `reviewed_by_user_id` int DEFAULT NULL,
  `reviewed_at` datetime DEFAULT NULL,
  `review_notes` text,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

--
-- Dumping data for table `lost_found_sightings`
--

INSERT INTO `lost_found_sightings` (`id`, `case_number`, `report_id`, `submitted_by_user_id`, `status`, `barangay_id`, `barangay_name`, `location_text`, `latitude`, `longitude`, `sighting_date`, `sighting_time`, `notes`, `photo_path`, `image_features`, `contact_name`, `contact_phone`, `contact_email`, `reviewed_by_user_id`, `reviewed_at`, `review_notes`, `created_at`, `updated_at`) VALUES
(1, 'SGT-20260524-8C32A4', 16, 3, 'rejected', 8, 'Bagong Nayon', 'alfa mart', NULL, NULL, '2026-05-25', NULL, 'nice', '/Final-Backend/backend/uploads/lost_found_sightings/lost_found_sightings_1779606468_9dc318cbaf49.jpg', '{\"sha1\":\"d54615897034567a012c1cf041e5ad5d11e8960f\",\"engine\":\"python\",\"width\":720,\"height\":730,\"mime\":\"image\\/jpeg\",\"avg_rgb\":[122,89,57],\"brightness_hash\":\"000000000000000001110000000011111000000011111000000011111100000011111110000011111110000111111011000000111001000000111100011100111100111111111100\",\"color_histogram\":[0.224854,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.163574,0,0,0,0.12085,0.029541,0,0,0,0,0,0,0,0,0,0,0.000488,0,0,0,0.088623,0.07959,0,0,0.000732,0.062012,0.00708,0,0,0,0.000244,0,0,0,0,0,0,0.000732,0,0,0,0.198486,0.007568,0,0,0,0.013916,0.001709]}', NULL, NULL, NULL, NULL, '2026-05-25 14:30:24', '', '2026-05-24 07:07:49', '2026-05-25 06:30:24'),
(2, 'SGT-20260525-7FC145', 28, NULL, 'active', 26, 'Calantipay', 'asd', NULL, NULL, '2026-05-26', NULL, 'asd', '/Final-Backend/backend/uploads/lost_found_sightings/lost_found_sightings_1779691500_4b2219483445.jpg', '{\"sha1\":\"3a44f9d90c6c8899589f3eebeedb7781058a9e9a\",\"width\":3072,\"height\":4096,\"mime\":\"image\\/jpeg\",\"engine\":\"metadata\"}', NULL, NULL, NULL, NULL, '2026-05-25 14:45:16', '', '2026-05-25 06:45:00', '2026-05-25 06:45:16'),
(3, 'SGT-20260525-C7A6AC', 28, NULL, 'rejected', 25, 'Catulinan', 'alfamart', 14.9629350, 120.9051020, '2026-05-26', NULL, 'may kasamgn tao nakapag holdig hands', '/Final-Backend/backend/uploads/lost_found_sightings/lost_found_sightings_1779694243_c26f558c7f71.jpg', '{\"sha1\":\"3a44f9d90c6c8899589f3eebeedb7781058a9e9a\",\"width\":3072,\"height\":4096,\"mime\":\"image\\/jpeg\",\"engine\":\"metadata\"}', NULL, NULL, NULL, NULL, '2026-05-25 15:31:12', '', '2026-05-25 07:30:44', '2026-05-25 07:31:12'),
(4, 'SGT-20260525-9885E5', 28, NULL, 'rejected', 8, 'Bagong Nayon', 'alfa mart', 14.9602750, 120.8983010, '2026-05-26', NULL, 'asd', NULL, NULL, NULL, NULL, NULL, NULL, '2026-05-25 15:32:00', '', '2026-05-25 07:31:44', '2026-05-25 07:32:00');

-- --------------------------------------------------------

--
-- Table structure for table `mass_vaccination_events`
--

CREATE TABLE `mass_vaccination_events` (
  `id` int NOT NULL,
  `event_date` date NOT NULL,
  `barangay` varchar(120) NOT NULL,
  `vaccine` varchar(120) NOT NULL,
  `status` varchar(40) NOT NULL DEFAULT 'Pending Report',
  `total_vaccinated` int DEFAULT NULL,
  `dogs_count` int NOT NULL DEFAULT '0',
  `cats_count` int NOT NULL DEFAULT '0',
  `others_count` int NOT NULL DEFAULT '0',
  `created_by_user_id` int DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

--
-- Dumping data for table `mass_vaccination_events`
--

INSERT INTO `mass_vaccination_events` (`id`, `event_date`, `barangay`, `vaccine`, `status`, `total_vaccinated`, `dogs_count`, `cats_count`, `others_count`, `created_by_user_id`, `created_at`, `updated_at`) VALUES
(1, '2026-06-02', 'Poblacion', '5-in-1', 'Completed', 25, 0, 0, 0, NULL, '2026-06-01 08:48:53', '2026-06-01 08:49:19'),
(2, '2026-06-13', 'Paitan', 'Anti-Rabies', 'Completed', 25, 0, 25, 0, NULL, '2026-06-12 10:20:51', '2026-06-12 10:21:02'),
(3, '2026-06-17', 'Pinagbarilan', 'Anti-Rabies', 'Completed', 50, 0, 0, 0, NULL, '2026-06-16 08:38:50', '2026-06-16 08:38:56');

-- --------------------------------------------------------

--
-- Table structure for table `owner_profiles`
--

CREATE TABLE `owner_profiles` (
  `id` int NOT NULL,
  `user_id` int NOT NULL,
  `barangay_id` int NOT NULL,
  `complete_address` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `verification_status` enum('pending','approved','rejected') COLLATE utf8mb4_unicode_ci DEFAULT 'pending',
  `verified_at` datetime DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `owner_profiles`
--

INSERT INTO `owner_profiles` (`id`, `user_id`, `barangay_id`, `complete_address`, `verification_status`, `verified_at`, `created_at`, `updated_at`) VALUES
(3, 3, 16, 'San Roque', 'approved', '2026-05-18 18:41:55', '2026-05-18 10:36:53', '2026-05-18 10:41:55'),
(5, 10, 3, 'Test Address', 'approved', '2026-05-27 16:56:53', '2026-05-27 08:56:53', '2026-05-27 08:56:53'),
(6, 11, 3, 'Edited Address', 'approved', '2026-05-27 16:57:21', '2026-05-27 08:57:21', '2026-05-27 08:57:37'),
(7, 12, 3, '', 'approved', '2026-05-27 17:00:13', '2026-05-27 09:00:13', '2026-05-27 09:00:13'),
(8, 13, 16, 'San Roque', 'pending', NULL, '2026-06-09 04:16:07', '2026-06-09 04:16:07');

-- --------------------------------------------------------

--
-- Table structure for table `password_reset_tokens`
--

CREATE TABLE `password_reset_tokens` (
  `id` int UNSIGNED NOT NULL,
  `user_id` int UNSIGNED NOT NULL,
  `token` char(64) NOT NULL,
  `expires_at` datetime NOT NULL,
  `used_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

--
-- Dumping data for table `password_reset_tokens`
--

INSERT INTO `password_reset_tokens` (`id`, `user_id`, `token`, `expires_at`, `used_at`, `created_at`) VALUES
(10, 8, '9e2398ff8542bd824196b530342d6b4827a8cc8f21825e72d90089481034c575', '2026-06-09 06:28:45', NULL, '2026-06-09 11:28:45'),
(13, 3, '907043c685d98669767b9da537706b786c6b682dd25ed90fcf74ff2dd4f394c4', '2026-06-09 07:10:25', '2026-06-09 12:14:17', '2026-06-09 12:10:25');

-- --------------------------------------------------------

--
-- Table structure for table `patient_record_profiles`
--

CREATE TABLE `patient_record_profiles` (
  `id` int NOT NULL,
  `pet_id` int NOT NULL,
  `patient_status` varchar(60) NOT NULL DEFAULT 'Active Patient',
  `health_status` varchar(120) DEFAULT NULL,
  `alert_text` varchar(120) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `is_archived` tinyint(1) NOT NULL DEFAULT '0'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

--
-- Dumping data for table `patient_record_profiles`
--

INSERT INTO `patient_record_profiles` (`id`, `pet_id`, `patient_status`, `health_status`, `alert_text`, `created_at`, `updated_at`, `is_archived`) VALUES
(4, 6, 'Archived', 'Good Standing', 'Archived', '2026-05-27 09:00:13', '2026-05-27 09:00:22', 1),
(6, 7, 'Active Patient', 'Good Standing', '', '2026-05-27 09:04:02', '2026-05-27 09:04:02', 0),
(7, 1, 'Archived', 'Archived', 'Archived', '2026-05-27 09:04:47', '2026-05-27 09:04:47', 1),
(8, 2, 'Archived', 'Archived', 'Archived', '2026-05-27 09:04:54', '2026-05-27 09:04:54', 1),
(9, 3, 'Archived', 'Archived', 'Archived', '2026-05-27 09:04:59', '2026-05-27 09:04:59', 1);

-- --------------------------------------------------------

--
-- Table structure for table `patient_vaccination_records`
--

CREATE TABLE `patient_vaccination_records` (
  `id` int NOT NULL,
  `pet_id` int NOT NULL,
  `visit_id` int DEFAULT NULL,
  `vaccine_name` varchar(160) NOT NULL,
  `description` varchar(255) DEFAULT NULL,
  `administered_date` date DEFAULT NULL,
  `provider` varchar(160) DEFAULT NULL,
  `next_due` date DEFAULT NULL,
  `status` varchar(120) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

--
-- Dumping data for table `patient_vaccination_records`
--

INSERT INTO `patient_vaccination_records` (`id`, `pet_id`, `visit_id`, `vaccine_name`, `description`, `administered_date`, `provider`, `next_due`, `status`, `created_at`) VALUES
(2, 7, 4, 'DHPPi-L 5-in-1', 'Pending', '2026-05-27', 'Dr. Kizea Bien Igaya', '2026-05-31', 'Pending', '2026-05-27 09:04:02');

-- --------------------------------------------------------

--
-- Table structure for table `patient_visit_records`
--

CREATE TABLE `patient_visit_records` (
  `id` int NOT NULL,
  `pet_id` int NOT NULL,
  `owner_id` int NOT NULL,
  `visit_title` varchar(160) DEFAULT NULL,
  `visit_date` date DEFAULT NULL,
  `follow_up_date` date DEFAULT NULL,
  `symptoms` text,
  `diagnosis` text,
  `treatment` text,
  `medications_json` json DEFAULT NULL,
  `category` varchar(80) DEFAULT NULL,
  `attending_vet` varchar(160) DEFAULT NULL,
  `vaccination_status` varchar(120) DEFAULT NULL,
  `vaccine_brand` varchar(120) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

--
-- Dumping data for table `patient_visit_records`
--

INSERT INTO `patient_visit_records` (`id`, `pet_id`, `owner_id`, `visit_title`, `visit_date`, `follow_up_date`, `symptoms`, `diagnosis`, `treatment`, `medications_json`, `category`, `attending_vet`, `vaccination_status`, `vaccine_brand`, `created_at`, `updated_at`) VALUES
(3, 6, 12, 'Initial', '2026-05-27', NULL, '', '', '', '[]', 'Routine Checkup', '', '', '', '2026-05-27 09:00:13', '2026-05-27 09:00:13'),
(4, 7, 3, 'Annual Checkup, Post-Surgery Follow-up', '2026-05-27', '2026-05-31', 'NA', 'NA', 'NA', '[\"Amoxicillin 250mg\", \"Meloxicam 7.5mg\"]', 'Vaccination', 'Dr. Kizea Bien Igaya', 'Pending', 'DHPPi-L 5-in-1', '2026-05-27 09:04:02', '2026-05-27 09:04:02');

-- --------------------------------------------------------

--
-- Table structure for table `pets`
--

CREATE TABLE `pets` (
  `id` int NOT NULL,
  `owner_id` int NOT NULL,
  `pet_name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `species` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `breed` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `sex` enum('male','female') COLLATE utf8mb4_unicode_ci NOT NULL,
  `age` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `weight` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `size` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `color_markings` text COLLATE utf8mb4_unicode_ci,
  `photo` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `last_vaccination_date` date DEFAULT NULL,
  `health_status` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `pets`
--

INSERT INTO `pets` (`id`, `owner_id`, `pet_name`, `species`, `breed`, `sex`, `age`, `weight`, `size`, `color_markings`, `photo`, `last_vaccination_date`, `health_status`, `created_at`, `updated_at`) VALUES
(1, 3, 'Copper', 'Dog', 'chuwawa', 'male', '2', '', '', '', NULL, '2026-05-11', '', '2026-05-18 15:10:54', '2026-05-18 15:10:54'),
(2, 8, 'sheena', 'Dog', 'chuwawa', 'male', '1', '', '', '', NULL, '2026-05-21', '', '2026-05-19 09:07:37', '2026-05-19 09:07:37'),
(3, 3, 'sheena', 'Dog', 'chuwawa', 'male', '2', '', '', '', NULL, '2026-05-20', '', '2026-05-19 09:30:33', '2026-05-19 09:30:33'),
(6, 12, 'Backend Archive Test', 'Canine', 'Test', 'female', '1', '', NULL, '', NULL, '2026-05-27', 'Good Standing', '2026-05-27 09:00:13', '2026-05-27 09:00:13'),
(7, 3, 'Copper', 'Feline', 'Golden Retriever', 'female', '2 years old', '32.5 kg', NULL, 'Golden / Honey coat, white patch on chest', NULL, '2026-05-27', 'Good Standing', '2026-05-27 09:04:02', '2026-05-27 09:04:02');

-- --------------------------------------------------------

--
-- Table structure for table `reviews`
--

CREATE TABLE `reviews` (
  `reviews_id` int NOT NULL,
  `appointment_id` int NOT NULL,
  `owner_id` int DEFAULT NULL,
  `veterinarian_id` int DEFAULT NULL,
  `rating` tinyint NOT NULL,
  `comment` text COLLATE utf8mb4_unicode_ci,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP
) ;

--
-- Dumping data for table `reviews`
--

INSERT INTO `reviews` (`reviews_id`, `appointment_id`, `owner_id`, `veterinarian_id`, `rating`, `comment`, `created_at`) VALUES
(1, 4, 3, 6, 2, 'nice', '2026-05-20 18:19:28');

-- --------------------------------------------------------

--
-- Table structure for table `roles`
--

CREATE TABLE `roles` (
  `id` int NOT NULL,
  `name` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `roles`
--

INSERT INTO `roles` (`id`, `name`, `description`, `created_at`, `updated_at`) VALUES
(5, 'pet_owner', 'Pet owner user', '2026-05-18 09:50:48', '2026-05-18 09:50:48'),
(6, 'veterinarian', 'Veterinarian staff', '2026-05-18 09:50:48', '2026-05-18 09:50:48'),
(7, 'admin', 'System administrator', '2026-05-18 09:50:48', '2026-05-18 09:50:48');

-- --------------------------------------------------------

--
-- Table structure for table `users`
--

CREATE TABLE `users` (
  `id` int NOT NULL,
  `role_id` int NOT NULL,
  `full_name` varchar(150) COLLATE utf8mb4_unicode_ci NOT NULL,
  `email` varchar(150) COLLATE utf8mb4_unicode_ci NOT NULL,
  `password_hash` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `phone_number` varchar(30) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `profile_photo` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `account_status` enum('active','inactive','blocked') COLLATE utf8mb4_unicode_ci DEFAULT 'inactive',
  `last_login_at` datetime DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `users`
--

INSERT INTO `users` (`id`, `role_id`, `full_name`, `email`, `password_hash`, `phone_number`, `profile_photo`, `account_status`, `last_login_at`, `created_at`, `updated_at`) VALUES
(3, 5, 'Mark ivan Jalova. villaster', 'markdeppaa@gmail.com', '$2y$10$EUiZ3gAGp8hLYTQ42E3OqeBBtmGwO3NT.EH/iyhXZ7Ij55Fr7/VDW', '999224422', NULL, 'active', '2026-06-17 17:54:29', '2026-05-18 10:36:53', '2026-06-17 09:54:29'),
(6, 6, 'Kizea igaya', 'admin@test.com', '$2y$10$X7z5mluqoHmIOSxV3yoH..Pqa7QWRy1Nrox2J05vEHnGAbv6uoyVO', '09123456789', '/Final-Backend/backend/uploads/profile/profile_1779175167_0279c4829cce.jpg', 'active', '2026-06-17 18:06:22', '2026-05-19 07:19:27', '2026-06-17 10:06:22'),
(8, 5, 'wearwell daily', 'wearwelldaily@gmail.com', '$2y$10$NZm9BSrDFizLl/1WqojVKedHCgvKKpwCe09o/UmuVw0KqkCCezKrS', '09959210640', NULL, 'active', NULL, '2026-05-19 09:07:37', '2026-05-19 09:07:37'),
(10, 5, 'Backend Test Owner', 'backend-test-1779872213@example.com', '$2y$10$5LV/fy6PrW4esjwI3TZt/OwfNjy6vfIAo93mQvuXKG8GBgWJCdlvC', '09170000000', NULL, 'active', NULL, '2026-05-27 08:56:53', '2026-05-27 08:56:53'),
(11, 5, 'Backend Update Owner Edited', 'backend-update-edited@example.com', '$2y$10$Mkq5Co89X.tLnngk3wJK0ujST3LJxWO.P9c1qy5WfPBT3bH9IcTby', '09171111111', NULL, 'active', NULL, '2026-05-27 08:57:21', '2026-05-27 08:57:37'),
(12, 5, 'Archive Owner', 'archive-test-1779872413@example.com', '$2y$10$t7zgj40M2D9fgb.L/GUBneulv44HtvURGEIB7lZR2huAZxktvFiUq', '', NULL, 'active', NULL, '2026-05-27 09:00:13', '2026-05-27 09:00:13'),
(13, 5, 'kzieas', 'kiritovillaster@gmail.com', '$2y$10$hzVS8sRsaQGFoaApIncFw.uEpwoDe22oBa9HcW6fPxs/0xk.Mfg0K', '09959210640', NULL, 'inactive', NULL, '2026-06-09 04:16:07', '2026-06-09 04:16:07'),
(14, 7, 'Admin', 'AdminTest@test.com', '$2y$10$yr/3j3bR2C3DG38DILKktuU5lNA8yVvCmlLkBCtK2Wp0stL3GdrQq', '09959210640', NULL, 'active', '2026-06-17 18:08:49', '2026-06-17 10:07:47', '2026-06-17 10:08:49');

-- --------------------------------------------------------

--
-- Table structure for table `user_notification_preferences`
--

CREATE TABLE `user_notification_preferences` (
  `user_id` int NOT NULL,
  `lost_found_alerts` tinyint(1) NOT NULL DEFAULT '1',
  `appointment_reminders` tinyint(1) NOT NULL DEFAULT '1',
  `chatbot_updates` tinyint(1) NOT NULL DEFAULT '0',
  `quiet_hours_enabled` tinyint(1) NOT NULL DEFAULT '0',
  `quiet_hours_start` time NOT NULL DEFAULT '22:00:00',
  `quiet_hours_end` time NOT NULL DEFAULT '07:00:00',
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- --------------------------------------------------------

--
-- Table structure for table `notifications`
--
-- Shared staff notification feed: rows written here are read by both the
-- admin and vet dashboards (filtered by `audience`), replacing the two
-- disconnected/synthetic per-dashboard notification builders.
--

CREATE TABLE `notifications` (
  `id` int NOT NULL AUTO_INCREMENT,
  `audience` enum('admin','vet','both') NOT NULL DEFAULT 'both',
  `type` varchar(50) NOT NULL,
  `title` varchar(255) NOT NULL,
  `message` text NOT NULL,
  `reference_id` int DEFAULT NULL,
  `is_read` tinyint(1) NOT NULL DEFAULT '0',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_audience_created` (`audience`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- --------------------------------------------------------

--
-- Table structure for table `user_verification_documents`
--

CREATE TABLE `user_verification_documents` (
  `id` int NOT NULL,
  `user_id` int NOT NULL,
  `document_type` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `file_path` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `original_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `mime_type` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `file_size` int DEFAULT NULL,
  `status` enum('pending','approved','rejected') COLLATE utf8mb4_unicode_ci DEFAULT 'pending',
  `reviewed_by_user_id` int DEFAULT NULL,
  `review_notes` text COLLATE utf8mb4_unicode_ci,
  `reviewed_at` datetime DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `user_verification_documents`
--

INSERT INTO `user_verification_documents` (`id`, `user_id`, `document_type`, `file_path`, `original_name`, `mime_type`, `file_size`, `status`, `reviewed_by_user_id`, `review_notes`, `reviewed_at`, `created_at`, `updated_at`) VALUES
(3, 3, 'proof_of_residence', 'backend/uploads/verification/proof_3_5466f9111d848542.jpg', '2f6445b2b7ce58820ab7b6aa3822675a.jpg', 'image/jpeg', 48654, 'pending', NULL, NULL, NULL, '2026-05-18 10:36:53', '2026-05-18 10:36:53'),
(5, 13, 'proof_of_residence', 'backend/uploads/verification/proof_13_13d4f9a0df073086.jpg', '374d8aa4e790d40421832d1050353de2.jpg', 'image/jpeg', 32879, 'pending', NULL, NULL, NULL, '2026-06-09 04:16:07', '2026-06-09 04:16:07');

-- --------------------------------------------------------

--
-- Table structure for table `veterinarian_profiles`
--

CREATE TABLE `veterinarian_profiles` (
  `id` int NOT NULL,
  `user_id` int NOT NULL,
  `license_number` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `position_title` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `education` text COLLATE utf8mb4_unicode_ci,
  `specialization` varchar(150) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `clinic_location` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `bio` text COLLATE utf8mb4_unicode_ci,
  `employment_status` enum('active','inactive') COLLATE utf8mb4_unicode_ci DEFAULT 'active',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `veterinarian_profiles`
--

INSERT INTO `veterinarian_profiles` (`id`, `user_id`, `license_number`, `position_title`, `education`, `specialization`, `clinic_location`, `bio`, `employment_status`, `created_at`, `updated_at`) VALUES
(2, 6, '12--123.-2312', 'Head Surgeon', 'PUP major in Medicine', 'Medicine', 'Baliwag Bulacan', NULL, 'active', '2026-05-19 07:19:27', '2026-05-19 07:19:27');

--
-- Indexes for dumped tables
--

--
-- Indexes for table `announcements`
--
ALTER TABLE `announcements`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_announcements_status_date` (`status`,`event_date`),
  ADD KEY `idx_announcements_created` (`created_at`);

--
-- Indexes for table `appointments`
--
ALTER TABLE `appointments`
  ADD PRIMARY KEY (`id`),
  ADD KEY `owner_id` (`owner_id`),
  ADD KEY `pet_id` (`pet_id`),
  ADD KEY `veterinarian_id` (`veterinarian_id`),
  ADD KEY `reviewed_by_user_id` (`reviewed_by_user_id`);

--
-- Indexes for table `barangays`
--
ALTER TABLE `barangays`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `chatbot_consultation_logs`
--
ALTER TABLE `chatbot_consultation_logs`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_chatbot_logs_created` (`created_at`),
  ADD KEY `idx_chatbot_logs_barangay` (`barangay_id`);

--
-- Indexes for table `chatbot_consultation_rules`
--
ALTER TABLE `chatbot_consultation_rules`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_chatbot_consult_status` (`status`),
  ADD KEY `idx_chatbot_consult_pet` (`pet_type`),
  ADD KEY `idx_chatbot_consult_duration` (`duration`),
  ADD KEY `idx_chatbot_consult_severity` (`severity`);

--
-- Indexes for table `chatbot_inquiry_logs`
--
ALTER TABLE `chatbot_inquiry_logs`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_chatbot_inquiry_logs_rule` (`inquiry_rule_id`),
  ADD KEY `idx_chatbot_inquiry_logs_created` (`created_at`);

--
-- Indexes for table `chatbot_inquiry_rules`
--
ALTER TABLE `chatbot_inquiry_rules`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_chatbot_inquiry_status` (`status`);

--
-- Indexes for table `contact_verifications`
--
ALTER TABLE `contact_verifications`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_contact` (`contact_type`,`contact_value`);

--
-- Indexes for table `lost_found_claims`
--
ALTER TABLE `lost_found_claims`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `case_number` (`case_number`),
  ADD KEY `idx_lfc_report` (`report_id`),
  ADD KEY `idx_lfc_status` (`status`),
  ADD KEY `fk_lfc_user` (`claimant_user_id`);

--
-- Indexes for table `lost_found_matches`
--
ALTER TABLE `lost_found_matches`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uniq_lfm_pair` (`lost_report_id`,`found_report_id`,`sighting_id`),
  ADD KEY `idx_lfm_status` (`status`),
  ADD KEY `fk_lfm_found` (`found_report_id`),
  ADD KEY `fk_lfm_sighting` (`sighting_id`);

--
-- Indexes for table `lost_found_reports`
--
ALTER TABLE `lost_found_reports`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `case_number` (`case_number`),
  ADD KEY `idx_lfr_type_status` (`report_type`,`status`),
  ADD KEY `idx_lfr_barangay` (`barangay_id`),
  ADD KEY `idx_lfr_owner` (`owner_id`);

--
-- Indexes for table `lost_found_sightings`
--
ALTER TABLE `lost_found_sightings`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `case_number` (`case_number`),
  ADD KEY `idx_lfs_report` (`report_id`),
  ADD KEY `idx_lfs_status` (`status`),
  ADD KEY `fk_lfs_user` (`submitted_by_user_id`),
  ADD KEY `fk_lfs_barangay` (`barangay_id`);

--
-- Indexes for table `mass_vaccination_events`
--
ALTER TABLE `mass_vaccination_events`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_mve_date` (`event_date`),
  ADD KEY `idx_mve_status` (`status`);

--
-- Indexes for table `owner_profiles`
--
ALTER TABLE `owner_profiles`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `user_id` (`user_id`),
  ADD KEY `barangay_id` (`barangay_id`);

--
-- Indexes for table `password_reset_tokens`
--
ALTER TABLE `password_reset_tokens`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `token` (`token`),
  ADD KEY `idx_user` (`user_id`);

--
-- Indexes for table `patient_record_profiles`
--
ALTER TABLE `patient_record_profiles`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `pet_id` (`pet_id`),
  ADD KEY `idx_prp_pet` (`pet_id`);

--
-- Indexes for table `patient_vaccination_records`
--
ALTER TABLE `patient_vaccination_records`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_pvacc_pet` (`pet_id`),
  ADD KEY `idx_pvacc_visit` (`visit_id`);

--
-- Indexes for table `patient_visit_records`
--
ALTER TABLE `patient_visit_records`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_pvr_pet` (`pet_id`),
  ADD KEY `idx_pvr_visit_date` (`visit_date`),
  ADD KEY `idx_pvr_followup` (`follow_up_date`),
  ADD KEY `idx_pvr_category` (`category`);

--
-- Indexes for table `pets`
--
ALTER TABLE `pets`
  ADD PRIMARY KEY (`id`),
  ADD KEY `owner_id` (`owner_id`);

--
-- Indexes for table `reviews`
--
ALTER TABLE `reviews`
  ADD PRIMARY KEY (`reviews_id`),
  ADD UNIQUE KEY `appointment_id` (`appointment_id`);

--
-- Indexes for table `roles`
--
ALTER TABLE `roles`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `name` (`name`);

--
-- Indexes for table `users`
--
ALTER TABLE `users`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `email` (`email`),
  ADD KEY `role_id` (`role_id`);

--
-- Indexes for table `user_notification_preferences`
--
ALTER TABLE `user_notification_preferences`
  ADD PRIMARY KEY (`user_id`);

--
-- Indexes for table `user_verification_documents`
--
ALTER TABLE `user_verification_documents`
  ADD PRIMARY KEY (`id`),
  ADD KEY `user_id` (`user_id`),
  ADD KEY `reviewed_by_user_id` (`reviewed_by_user_id`);

--
-- Indexes for table `veterinarian_profiles`
--
ALTER TABLE `veterinarian_profiles`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `user_id` (`user_id`);

--
-- AUTO_INCREMENT for dumped tables
--

--
-- AUTO_INCREMENT for table `announcements`
--
ALTER TABLE `announcements`
  MODIFY `id` int NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=4;

--
-- AUTO_INCREMENT for table `appointments`
--
ALTER TABLE `appointments`
  MODIFY `id` int NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=5;

--
-- AUTO_INCREMENT for table `barangays`
--
ALTER TABLE `barangays`
  MODIFY `id` int NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=30;

--
-- AUTO_INCREMENT for table `chatbot_consultation_logs`
--
ALTER TABLE `chatbot_consultation_logs`
  MODIFY `id` int NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=10;

--
-- AUTO_INCREMENT for table `chatbot_consultation_rules`
--
ALTER TABLE `chatbot_consultation_rules`
  MODIFY `id` int NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=10;

--
-- AUTO_INCREMENT for table `chatbot_inquiry_logs`
--
ALTER TABLE `chatbot_inquiry_logs`
  MODIFY `id` int NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=3;

--
-- AUTO_INCREMENT for table `chatbot_inquiry_rules`
--
ALTER TABLE `chatbot_inquiry_rules`
  MODIFY `id` int NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=11;

--
-- AUTO_INCREMENT for table `contact_verifications`
--
ALTER TABLE `contact_verifications`
  MODIFY `id` int UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=21;

--
-- AUTO_INCREMENT for table `lost_found_claims`
--
ALTER TABLE `lost_found_claims`
  MODIFY `id` int NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=4;

--
-- AUTO_INCREMENT for table `lost_found_matches`
--
ALTER TABLE `lost_found_matches`
  MODIFY `id` int NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=35;

--
-- AUTO_INCREMENT for table `lost_found_reports`
--
ALTER TABLE `lost_found_reports`
  MODIFY `id` int NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=31;

--
-- AUTO_INCREMENT for table `lost_found_sightings`
--
ALTER TABLE `lost_found_sightings`
  MODIFY `id` int NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=5;

--
-- AUTO_INCREMENT for table `mass_vaccination_events`
--
ALTER TABLE `mass_vaccination_events`
  MODIFY `id` int NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=4;

--
-- AUTO_INCREMENT for table `owner_profiles`
--
ALTER TABLE `owner_profiles`
  MODIFY `id` int NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=9;

--
-- AUTO_INCREMENT for table `password_reset_tokens`
--
ALTER TABLE `password_reset_tokens`
  MODIFY `id` int UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=14;

--
-- AUTO_INCREMENT for table `patient_record_profiles`
--
ALTER TABLE `patient_record_profiles`
  MODIFY `id` int NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=10;

--
-- AUTO_INCREMENT for table `patient_vaccination_records`
--
ALTER TABLE `patient_vaccination_records`
  MODIFY `id` int NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=3;

--
-- AUTO_INCREMENT for table `patient_visit_records`
--
ALTER TABLE `patient_visit_records`
  MODIFY `id` int NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=5;

--
-- AUTO_INCREMENT for table `pets`
--
ALTER TABLE `pets`
  MODIFY `id` int NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=8;

--
-- AUTO_INCREMENT for table `reviews`
--
ALTER TABLE `reviews`
  MODIFY `reviews_id` int NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `roles`
--
ALTER TABLE `roles`
  MODIFY `id` int NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=8;

--
-- AUTO_INCREMENT for table `users`
--
ALTER TABLE `users`
  MODIFY `id` int NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=15;

--
-- AUTO_INCREMENT for table `user_verification_documents`
--
ALTER TABLE `user_verification_documents`
  MODIFY `id` int NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=6;

--
-- AUTO_INCREMENT for table `veterinarian_profiles`
--
ALTER TABLE `veterinarian_profiles`
  MODIFY `id` int NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=4;

--
-- Constraints for dumped tables
--

--
-- Constraints for table `appointments`
--
ALTER TABLE `appointments`
  ADD CONSTRAINT `appointments_ibfk_1` FOREIGN KEY (`owner_id`) REFERENCES `users` (`id`),
  ADD CONSTRAINT `appointments_ibfk_2` FOREIGN KEY (`pet_id`) REFERENCES `pets` (`id`),
  ADD CONSTRAINT `appointments_ibfk_3` FOREIGN KEY (`veterinarian_id`) REFERENCES `users` (`id`),
  ADD CONSTRAINT `appointments_ibfk_4` FOREIGN KEY (`reviewed_by_user_id`) REFERENCES `users` (`id`);

--
-- Constraints for table `lost_found_claims`
--
ALTER TABLE `lost_found_claims`
  ADD CONSTRAINT `fk_lfc_report` FOREIGN KEY (`report_id`) REFERENCES `lost_found_reports` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `fk_lfc_user` FOREIGN KEY (`claimant_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL;

--
-- Constraints for table `lost_found_matches`
--
ALTER TABLE `lost_found_matches`
  ADD CONSTRAINT `fk_lfm_found` FOREIGN KEY (`found_report_id`) REFERENCES `lost_found_reports` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `fk_lfm_lost` FOREIGN KEY (`lost_report_id`) REFERENCES `lost_found_reports` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `fk_lfm_sighting` FOREIGN KEY (`sighting_id`) REFERENCES `lost_found_sightings` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `lost_found_reports`
--
ALTER TABLE `lost_found_reports`
  ADD CONSTRAINT `fk_lfr_barangay` FOREIGN KEY (`barangay_id`) REFERENCES `barangays` (`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `fk_lfr_owner` FOREIGN KEY (`owner_id`) REFERENCES `users` (`id`) ON DELETE SET NULL;

--
-- Constraints for table `lost_found_sightings`
--
ALTER TABLE `lost_found_sightings`
  ADD CONSTRAINT `fk_lfs_barangay` FOREIGN KEY (`barangay_id`) REFERENCES `barangays` (`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `fk_lfs_report` FOREIGN KEY (`report_id`) REFERENCES `lost_found_reports` (`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `fk_lfs_user` FOREIGN KEY (`submitted_by_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL;

--
-- Constraints for table `owner_profiles`
--
ALTER TABLE `owner_profiles`
  ADD CONSTRAINT `owner_profiles_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`),
  ADD CONSTRAINT `owner_profiles_ibfk_2` FOREIGN KEY (`barangay_id`) REFERENCES `barangays` (`id`);

--
-- Constraints for table `pets`
--
ALTER TABLE `pets`
  ADD CONSTRAINT `pets_ibfk_1` FOREIGN KEY (`owner_id`) REFERENCES `users` (`id`);

--
-- Constraints for table `reviews`
--
ALTER TABLE `reviews`
  ADD CONSTRAINT `reviews_ibfk_1` FOREIGN KEY (`appointment_id`) REFERENCES `appointments` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `users`
--
ALTER TABLE `users`
  ADD CONSTRAINT `users_ibfk_1` FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`);

--
-- Constraints for table `user_verification_documents`
--
ALTER TABLE `user_verification_documents`
  ADD CONSTRAINT `user_verification_documents_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`),
  ADD CONSTRAINT `user_verification_documents_ibfk_2` FOREIGN KEY (`reviewed_by_user_id`) REFERENCES `users` (`id`);

--
-- Constraints for table `veterinarian_profiles`
--
ALTER TABLE `veterinarian_profiles`
  ADD CONSTRAINT `veterinarian_profiles_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`);
COMMIT;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
