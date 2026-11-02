<?php
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization, Accept, X-Admin-Key');
header('Cache-Control: no-store');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

require_once __DIR__ . '/access_lib.php';

$action = $_GET['action'] ?? '';
$path   = isset($_GET['path']) ? preg_replace('/[^a-zA-Z0-9_\-]/', '', $_GET['path']) : '';

// ---- Access control endpoints ----
if ($action === 'check_access') {
  header('Content-Type: application/json; charset=utf-8');
  $in = json_decode(file_get_contents('php://input'), true) ?: [];
  $id = (string)($in['id'] ?? '');
  if ($id === '') {
    echo json_encode(['ok' => false, 'status' => 'pending', 'admin_contact' => ADMIN_CONTACT]);
    exit;
  }
  echo json_encode(access_check($id, $in['phone'] ?? '', $in['name'] ?? ''), JSON_UNESCAPED_UNICODE);
  exit;
}

if ($action === 'admin_list') {
  require_admin_key();
  header('Content-Type: application/json; charset=utf-8');
  $d = access_load();
  $pendingList = [];
  foreach ($d['pending'] as $id => $meta) {
    $pendingList[] = [
      'id' => (string)$id,
      'phone' => $meta['phone'] ?? '',
      'name' => $meta['name'] ?? '',
      'time' => $meta['time'] ?? '',
    ];
  }
  usort($pendingList, function($a, $b) { return strcmp($b['time'], $a['time']); });
  echo json_encode([
    'ok' => true,
    'approved' => $d['approved'],
    'rejected' => $d['rejected'],
    'pending' => $pendingList,
    'admin_contact' => ADMIN_CONTACT,
  ], JSON_UNESCAPED_UNICODE);
  exit;
}

if ($action === 'admin_approve') {
  require_admin_key();
  header('Content-Type: application/json; charset=utf-8');
  $in = json_decode(file_get_contents('php://input'), true) ?: [];
  $id = (string)($in['id'] ?? '');
  $d = access_load();
  $d['rejected'] = array_values(array_filter($d['rejected'], fn($x) => $x !== $id));
  if (!in_array($id, $d['approved'], true)) $d['approved'][] = $id;
  unset($d['pending'][$id]);
  access_save($d);
  echo json_encode(['ok' => true, 'approved' => $d['approved']]);
  exit;
}

if ($action === 'admin_reject') {
  require_admin_key();
  header('Content-Type: application/json; charset=utf-8');
  $in = json_decode(file_get_contents('php://input'), true) ?: [];
  $id = (string)($in['id'] ?? '');
  $d = access_load();
  $d['approved'] = array_values(array_filter($d['approved'], fn($x) => $x !== $id));
  if (!in_array($id, $d['rejected'], true)) $d['rejected'][] = $id;
  unset($d['pending'][$id]);
  access_save($d);
  echo json_encode(['ok' => true, 'rejected' => $d['rejected']]);
  exit;
}

if ($action === 'admin_remove_approved') {
  require_admin_key();
  header('Content-Type: application/json; charset=utf-8');
  $in = json_decode(file_get_contents('php://input'), true) ?: [];
  $id = (string)($in['id'] ?? '');
  $d = access_load();
  $d['approved'] = array_values(array_filter($d['approved'], fn($x) => $x !== $id));
  access_save($d);
  echo json_encode(['ok' => true, 'approved' => $d['approved']]);
  exit;
}

if ($action === 'admin_remove_rejected') {
  require_admin_key();
  header('Content-Type: application/json; charset=utf-8');
  $in = json_decode(file_get_contents('php://input'), true) ?: [];
  $id = (string)($in['id'] ?? '');
  $d = access_load();
  $d['rejected'] = array_values(array_filter($d['rejected'], fn($x) => $x !== $id));
  access_save($d);
  echo json_encode(['ok' => true, 'rejected' => $d['rejected']]);
  exit;
}

// ---- Health / GetConfig soft ----
if ($path === '' || $path === 'health') {
  header('Content-Type: application/json');
  echo json_encode(['ok' => true, 'service' => 'shwe-proxy']);
  exit;
}
if ($path === 'GetConfig') {
  header('Content-Type: application/json');
  echo json_encode(['status' => 'ok', 'notice' => null]);
  exit;
}

// ---- Upstream proxy ----
$UPSTREAM = 'https://api.shweshwbb.com/api/webapi/';
if ($path === '') {
  header('Content-Type: application/json');
  echo json_encode(['code' => -1, 'msg' => 'missing path']);
  exit;
}
$url = rtrim($UPSTREAM, '/') . '/' . $path;
$raw = file_get_contents('php://input');
if ($raw === false || $raw === '') $raw = '{}';

$headers = [
  'Content-Type: application/json;charset=UTF-8',
  'Accept: application/json, text/plain, */*',
  'ar-origin: https://shwelottery.net',
  'Origin: https://shwelottery.net',
  'Referer: https://shwelottery.net/',
  'User-Agent: Mozilla/5.0 (Linux; Android 12; Mobile) AppleWebKit/537.36 Chrome/137.0.0.0 Mobile Safari/537.36',
];
if (!empty($_SERVER['HTTP_AUTHORIZATION'])) {
  $headers[] = 'Authorization: ' . $_SERVER['HTTP_AUTHORIZATION'];
}

$ch = curl_init($url);
curl_setopt_array($ch, [
  CURLOPT_RETURNTRANSFER => true,
  CURLOPT_POST => true,
  CURLOPT_HTTPHEADER => $headers,
  CURLOPT_POSTFIELDS => $raw,
  CURLOPT_TIMEOUT => 30,
  CURLOPT_CONNECTTIMEOUT => 12,
  CURLOPT_FOLLOWLOCATION => true,
]);
$body = curl_exec($ch);
$status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
$err = curl_error($ch);
curl_close($ch);

header('Content-Type: application/json; charset=utf-8');
if ($body === false) {
  http_response_code(502);
  echo json_encode(['code' => -1, 'msg' => 'proxy_error', 'detail' => $err]);
  exit;
}
http_response_code($status > 0 ? $status : 502);
echo $body;
