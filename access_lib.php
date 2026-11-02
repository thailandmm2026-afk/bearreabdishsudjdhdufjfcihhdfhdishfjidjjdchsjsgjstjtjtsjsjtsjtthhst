<?php
define('ACCESS_FILE', __DIR__ . '/data/access.json');
define('ADMIN_KEY', 'kiki20251-admin');
define('ADMIN_CONTACT', '@kiki20251');

function access_load() {
  if (!is_file(ACCESS_FILE)) {
    return ['approved' => [], 'rejected' => [], 'pending' => []];
  }
  $raw = file_get_contents(ACCESS_FILE);
  $d = json_decode($raw, true);
  if (!is_array($d)) $d = [];
  return [
    'approved' => array_values(array_map('strval', $d['approved'] ?? [])),
    'rejected' => array_values(array_map('strval', $d['rejected'] ?? [])),
    'pending'  => is_array($d['pending'] ?? null) ? $d['pending'] : [],
  ];
}

function access_save($d) {
  $dir = dirname(ACCESS_FILE);
  if (!is_dir($dir)) mkdir($dir, 0775, true);
  $payload = [
    'approved' => array_values(array_unique(array_map('strval', $d['approved'] ?? []))),
    'rejected' => array_values(array_unique(array_map('strval', $d['rejected'] ?? []))),
    'pending'  => $d['pending'] ?? new stdClass(),
  ];
  file_put_contents(ACCESS_FILE, json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT), LOCK_EX);
}

function access_check($id, $phone = '', $name = '') {
  $id = (string)$id;
  $d = access_load();
  if (in_array($id, $d['approved'], true)) {
    return ['ok' => true, 'status' => 'approved', 'admin_contact' => ADMIN_CONTACT];
  }
  if (in_array($id, $d['rejected'], true)) {
    return ['ok' => false, 'status' => 'rejected', 'admin_contact' => ADMIN_CONTACT];
  }
  $d['pending'][$id] = [
    'phone' => (string)$phone,
    'name'  => (string)$name,
    'time'  => date('c'),
  ];
  access_save($d);
  return ['ok' => false, 'status' => 'pending', 'userId' => $id, 'admin_contact' => ADMIN_CONTACT];
}

function require_admin_key() {
  $key = $_SERVER['HTTP_X_ADMIN_KEY'] ?? ($_POST['key'] ?? ($_GET['key'] ?? ''));
  if ($key !== ADMIN_KEY) {
    http_response_code(401);
    header('Content-Type: application/json');
    echo json_encode(['ok' => false, 'error' => 'unauthorized']);
    exit;
  }
}
