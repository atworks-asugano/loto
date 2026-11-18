<?php
/**
 * 忘年会 抽選会 API
 * PHP 8.1 以上 / MySQL 5.7 以上
 *
 * 公開:  GET  ?a=state        応募画面の表示データ
 *        POST ?a=entry        応募・変更
 * 幹事:  GET  ?a=me           ログイン状態
 *        POST ?a=login / logout
 *        GET  ?a=admin_state  設定・応募一覧・抽選結果
 *        POST ?a=save_config / add_manual / delete_entry / draw / predraw_top / reveal / reset / reset_all / purge
 *        GET  ?a=export&type=entries|results   CSV出力
 */
declare(strict_types=1);

date_default_timezone_set('Asia/Tokyo');
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

const TOKEN_COOKIE = 'lot_token';
const MAX_NAME     = 12;
const ID_PATTERN   = '/^[A-Za-z0-9_-]{1,40}$/';

function out(array $data, int $code = 200): never
{
    http_response_code($code);
    echo json_encode(['ok' => true] + $data, JSON_UNESCAPED_UNICODE);
    exit;
}

function fail(int $code, string $message): never
{
    http_response_code($code);
    echo json_encode(['ok' => false, 'error' => $message], JSON_UNESCAPED_UNICODE);
    exit;
}

$configFile = __DIR__ . '/config.php';
if (!is_file($configFile)) {
    fail(500, 'config.php がありません。config.sample.php をコピーして設定してください。');
}
$CONF = require $configFile;

/* ---------- 共通 ---------- */

function isHttps(): bool
{
    global $CONF;
    if (isset($CONF['cookie_secure']) && is_bool($CONF['cookie_secure'])) {
        return $CONF['cookie_secure'];
    }
    return (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
}

function cookiePath(): string
{
    $dir = str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '/'));
    return rtrim($dir, '/') . '/';
}

function db(): PDO
{
    static $pdo = null;
    global $CONF;
    if ($pdo === null) {
        $d   = $CONF['db'];
        $dsn = sprintf('mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4', $d['host'], (int)($d['port'] ?? 3306), $d['name']);
        $pdo = new PDO($dsn, $d['user'], $d['pass'], [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES   => false,
        ]);
    }
    return $pdo;
}

function now(): string
{
    return date('Y-m-d H:i:s');
}

function cleanText(mixed $v, int $max): string
{
    $s = is_string($v) ? $v : '';
    $s = preg_replace('/[\x00-\x1F\x7F]/u', '', $s) ?? '';
    $s = preg_replace('/^[\s\x{3000}]+|[\s\x{3000}]+$/u', '', $s) ?? '';
    // mbstring 拡張がない環境でも動くよう、文字単位で切り詰める
    $chars = preg_split('//u', $s, -1, PREG_SPLIT_NO_EMPTY) ?: [];
    return implode('', array_slice($chars, 0, $max));
}

function input(): array
{
    $raw = file_get_contents('php://input') ?: '';
    $j   = json_decode($raw, true);
    return is_array($j) ? $j : [];
}

/** POSTの基本チェック（クロスサイトからの送信を防ぐ） */
function requirePost(): void
{
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
        fail(405, 'POSTで送信してください');
    }
    if (($_SERVER['HTTP_X_REQUESTED_WITH'] ?? '') !== 'fetch') {
        fail(400, '不正なリクエストです');
    }
    if (stripos($_SERVER['CONTENT_TYPE'] ?? '', 'application/json') !== 0) {
        fail(400, '不正なリクエストです');
    }
}

function startSession(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        return;
    }
    session_name('lot_admin');
    session_set_cookie_params([
        'lifetime' => 0,
        'path'     => cookiePath(),
        'secure'   => isHttps(),
        'httponly' => true,
        'samesite' => 'Strict',
    ]);
    session_start();
}

function isAdmin(): bool
{
    startSession();
    return !empty($_SESSION['admin']);
}

function requireAdmin(bool $write): void
{
    if (!isAdmin()) {
        fail(401, '幹事としてログインしてください');
    }
    if ($write) {
        $sent = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
        if (!is_string($sent) || !hash_equals($_SESSION['csrf'] ?? '', $sent)) {
            fail(403, '画面を再読み込みしてから、もう一度お試しください');
        }
    }
}

/* ---------- 設定 ---------- */

function defaultConfig(): array
{
    return [
        'title'          => '忘年会 抽選会',
        'entryOpen'      => true,
        'excludeWinners' => true,
        'topFallbackAll' => false,
        'order'          => 'top-first',
        'top'            => array_map(fn($i) => ['id' => 't' . $i, 'name' => '上位賞品 ' . $i, 'note' => ''], range(1, 5)),
        'lower'          => [
            ['id' => 'l1', 'name' => '下位賞品 A', 'count' => 3],
            ['id' => 'l2', 'name' => '下位賞品 B', 'count' => 2],
            ['id' => 'l3', 'name' => '下位賞品 C', 'count' => 1],
        ],
    ];
}

function loadConfig(): array
{
    $row = db()->query('SELECT data FROM lot_config WHERE id = 1')->fetch();
    $c   = $row ? json_decode($row['data'], true) : null;
    return array_merge(defaultConfig(), is_array($c) ? $c : []);
}

/** 抽選順に並べた景品一覧 */
function prizeList(array $c): array
{
    $top = [];
    foreach ($c['top'] as $p) {
        if (($p['name'] ?? '') !== '') {
            $top[] = ['id' => $p['id'], 'name' => $p['name'], 'note' => $p['note'] ?? '', 'tier' => 'top', 'count' => 1];
        }
    }
    $low = [];
    foreach ($c['lower'] as $p) {
        if (($p['name'] ?? '') !== '') {
            $low[] = ['id' => $p['id'], 'name' => $p['name'], 'tier' => 'lower', 'count' => max(1, min(3, (int)($p['count'] ?? 1)))];
        }
    }
    return $c['order'] === 'lower-first' ? array_merge($low, $top) : array_merge($top, $low);
}

function findPrize(array $c, string $id): ?array
{
    foreach (prizeList($c) as $p) {
        if ($p['id'] === $id) {
            return $p;
        }
    }
    return null;
}

function topIds(array $c): array
{
    return array_column(array_filter(prizeList($c), fn($p) => $p['tier'] === 'top'), 'id');
}

/* ---------- 応募者トークン ---------- */

function tokenHash(bool $create): ?string
{
    $t = $_COOKIE[TOKEN_COOKIE] ?? '';
    if (!is_string($t) || !preg_match('/^[a-f0-9]{64}$/', $t)) {
        if (!$create) {
            return null;
        }
        $t = bin2hex(random_bytes(32));
        setcookie(TOKEN_COOKIE, $t, [
            'expires'  => time() + 60 * 60 * 24 * 90,
            'path'     => cookiePath(),
            'secure'   => isHttps(),
            'httponly' => true,
            'samesite' => 'Lax',
        ]);
    }
    return hash('sha256', $t);
}

/* ---------- あみだくじ ---------- */

function rand01(): float
{
    return random_int(0, 999999) / 1000000;
}

function shuffled(array $a): array
{
    $a = array_values($a);
    for ($i = count($a) - 1; $i > 0; $i--) {
        $j = random_int(0, $i);
        [$a[$i], $a[$j]] = [$a[$j], $a[$i]];
    }
    return $a;
}

function rowsFor(int $n): int
{
    return max(9, min(22, (int)round($n * 0.5) + 9));
}

function generateLadder(int $n, int $k): array
{
    $rows  = rowsFor($n);
    $lanes = max($n - 1, 0);
    $grid  = array_fill(0, $rows, array_fill(0, max($lanes, 1), false));
    $rungs = [];
    for ($r = 0; $r < $rows; $r++) {
        for ($i = 0; $i < $lanes; $i++) {
            if ($i > 0 && $grid[$r][$i - 1]) {
                continue;
            }
            if (rand01() < 0.42) {
                $grid[$r][$i] = true;
                $rungs[] = ['r' => $r, 'i' => $i, 'y' => round(rand01(), 2)];
            }
        }
    }
    // どの隣り合う線の間にも最低1本は横線を入れる
    for ($i = 0; $i < $lanes; $i++) {
        $has = false;
        foreach ($rungs as $g) {
            if ($g['i'] === $i) { $has = true; break; }
        }
        if ($has) {
            continue;
        }
        foreach (shuffled(range(0, $rows - 1)) as $r) {
            $leftFree  = !($i > 0 && $grid[$r][$i - 1]);
            $rightFree = !($i < $lanes - 1 && $grid[$r][$i + 1]);
            if (!$grid[$r][$i] && $leftFree && $rightFree) {
                $grid[$r][$i] = true;
                $rungs[] = ['r' => $r, 'i' => $i, 'y' => round(rand01(), 2)];
                break;
            }
        }
    }
    $slots = array_slice(shuffled(range(0, $n - 1)), 0, min($k, $n));
    return ['rows' => $rows, 'rungs' => $rungs, 'slots' => $slots];
}

/** 各スタート位置がたどり着く下の位置 */
function ladderEnds(int $n, int $rows, array $rungs): array
{
    $map = [];
    foreach ($rungs as $g) {
        $map[$g['r'] * 1000 + $g['i']] = true;
    }
    $ends = [];
    for ($s = 0; $s < $n; $s++) {
        $p = $s;
        for ($r = 0; $r < $rows; $r++) {
            if (isset($map[$r * 1000 + $p])) {
                $p++;
            } elseif ($p > 0 && isset($map[$r * 1000 + $p - 1])) {
                $p--;
            }
        }
        $ends[] = $p;
    }
    return $ends;
}

/** 抽選対象者（クライアント側の表示と同じ規則） */
function computePool(array $c, array $prize, array $excluded): array
{
    $entries = db()->query('SELECT id, name, choice FROM lot_entries ORDER BY id')->fetchAll();
    $taken   = [];
    if ($c['excludeWinners']) {
        foreach (db()->query('SELECT prize_id, data FROM lot_draws') as $row) {
            if ($row['prize_id'] === $prize['id']) {
                continue;
            }
            $d = json_decode($row['data'], true);
            foreach ($d['winners'] ?? [] as $w) {
                $taken[(int)$w['id']] = true;
            }
        }
    }
    $notTaken = fn($e) => !isset($taken[(int)$e['id']]);
    $cands    = $prize['tier'] === 'top'
        ? array_filter($entries, fn($e) => $e['choice'] === $prize['id'])
        : $entries;
    $cands    = array_filter($cands, $notTaken);
    $fallback = false;
    if ($prize['tier'] === 'top' && !$cands && $c['topFallbackAll']) {
        $cands    = array_filter($entries, $notTaken);
        $fallback = true;
    }
    $ex    = array_flip(array_map('intval', $excluded));
    $cands = array_filter($cands, fn($e) => !isset($ex[(int)$e['id']]));
    return [array_values($cands), $fallback];
}

function drawsMap(): array
{
    $map = [];
    foreach (db()->query('SELECT prize_id, status, data, revealed_at FROM lot_draws') as $row) {
        $d = json_decode($row['data'], true) ?: [];
        $d['status']     = $row['status'];
        $d['revealedAt'] = $row['revealed_at'] ? strtotime($row['revealed_at']) * 1000 : null;
        $map[$row['prize_id']] = $d;
    }
    return $map;
}

/** あみだくじを作って当選者を決め、未発表（draft）として保存する。対象者がいなければ null */
function createDraw(array $c, array $prize, array $excluded, bool $predrawn): ?array
{
    [$cands, $fallback] = computePool($c, $prize, $excluded);
    if (!$cands) {
        return null;
    }
    $n          = count($cands);
    $k          = min($prize['count'], $n);
    $ladder     = generateLadder($n, $k);
    $candidates = array_map(fn($e) => ['id' => (int)$e['id'], 'name' => $e['name']], shuffled($cands));
    $ends       = ladderEnds($n, $ladder['rows'], $ladder['rungs']);
    $winners    = array_map(fn($slot) => $candidates[array_search($slot, $ends, true)], $ladder['slots']);
    $draw = [
        'prizeId'    => $prize['id'],
        'prizeName'  => $prize['name'],
        'tier'       => $prize['tier'],
        'fallback'   => $fallback,
        'predrawn'   => $predrawn,
        'candidates' => $candidates,
        'rows'       => $ladder['rows'],
        'rungs'      => $ladder['rungs'],
        'slots'      => $ladder['slots'],
        'winners'    => $winners,
        'at'         => (int)(microtime(true) * 1000),
    ];
    try {
        $st = db()->prepare("INSERT INTO lot_draws (prize_id, status, data, created_at) VALUES (?, 'draft', ?, ?)");
        $st->execute([$prize['id'], json_encode($draw, JSON_UNESCAPED_UNICODE), now()]);
    } catch (PDOException $e) {
        if ($e->getCode() === '23000') {
            fail(409, '別の画面で先に抽選されました。画面を更新してください');
        }
        throw $e;
    }
    $draw['status'] = 'draft';
    return $draw;
}

/* ---------- CSV ---------- */

function csvCell(mixed $v): string
{
    $s = (string)$v;
    // 表計算ソフトの数式として解釈されないようにする
    return preg_match('/^[=+\-@\t\r]/', $s) ? "'" . $s : $s;
}

function sendCsv(string $filename, array $header, array $rows): never
{
    header('Content-Type: text/csv; charset=UTF-8');
    header('Content-Disposition: attachment; filename="' . $filename . '"');
    echo "\xEF\xBB\xBF";
    $f = fopen('php://output', 'w');
    fputcsv($f, $header);
    foreach ($rows as $r) {
        fputcsv($f, array_map('csvCell', $r));
    }
    fclose($f);
    exit;
}

/* ---------- ルーティング ---------- */

$action = (string)($_GET['a'] ?? '');

try {
    switch ($action) {

        case 'state': {
            $c    = loadConfig();
            $th   = tokenHash(false);
            $mine = null;
            if ($th) {
                $st = db()->prepare('SELECT id, name, choice FROM lot_entries WHERE token_hash = ?');
                $st->execute([$th]);
                $mine = $st->fetch() ?: null;
            }
            $no = 0;
            if ($mine) {
                $st = db()->prepare('SELECT COUNT(*) FROM lot_entries WHERE id <= ?');
                $st->execute([$mine['id']]);
                $no = (int)$st->fetchColumn();
            }
            $counts = [];
            foreach (db()->query('SELECT choice, COUNT(*) AS n FROM lot_entries GROUP BY choice') as $r) {
                $counts[$r['choice']] = (int)$r['n'];
            }
            $total   = (int)db()->query('SELECT COUNT(*) FROM lot_entries')->fetchColumn();
            $results = [];
            $rows    = db()->query("SELECT data FROM lot_draws WHERE status = 'revealed' ORDER BY revealed_at, prize_id")->fetchAll();
            foreach ($rows as $r) {
                $d = json_decode($r['data'], true) ?: [];
                $results[] = [
                    'prizeName' => $d['prizeName'] ?? '',
                    'names'     => array_column($d['winners'] ?? [], 'name'),
                    'mine'      => $mine ? in_array((int)$mine['id'], array_map('intval', array_column($d['winners'] ?? [], 'id')), true) : false,
                ];
            }
            $prizes = prizeList($c);
            out([
                'title'     => $c['title'],
                'entryOpen' => (bool)$c['entryOpen'],
                'top'       => array_values(array_map(fn($p) => ['id' => $p['id'], 'name' => $p['name'], 'note' => $p['note']], array_filter($prizes, fn($p) => $p['tier'] === 'top'))),
                'lower'     => array_values(array_map(fn($p) => ['name' => $p['name'], 'count' => $p['count']], array_filter($prizes, fn($p) => $p['tier'] === 'lower'))),
                'counts'    => (object)$counts,
                'total'     => $total,
                'mine'      => $mine ? ['name' => $mine['name'], 'choice' => $mine['choice']] : null,
                'no'        => $no,
                'results'   => $results,
            ]);
        }

        case 'entry': {
            requirePost();
            $c = loadConfig();
            if (!$c['entryOpen']) {
                fail(409, '受付は締め切りました');
            }
            $in     = input();
            $name   = cleanText($in['name'] ?? '', MAX_NAME);
            $choice = (string)($in['choice'] ?? '');
            if ($name === '') {
                fail(422, 'お名前を入力してください');
            }
            if (!in_array($choice, topIds($c), true)) {
                fail(422, '上位賞品をひとつ選んでください');
            }
            $th = tokenHash(true);
            $st = db()->prepare(
                'INSERT INTO lot_entries (token_hash, name, choice, manual, created_at, updated_at)
                 VALUES (?, ?, ?, 0, ?, ?)
                 ON DUPLICATE KEY UPDATE name = VALUES(name), choice = VALUES(choice), updated_at = VALUES(updated_at)'
            );
            $st->execute([$th, $name, $choice, now(), now()]);
            out([]);
        }

        case 'me': {
            $admin = isAdmin();
            out(['admin' => $admin, 'csrf' => $admin ? $_SESSION['csrf'] : null]);
        }

        case 'login': {
            requirePost();
            startSession();
            $hash = $CONF['admin_password_hash'] ?? '';
            if ($hash === '') {
                fail(500, '幹事パスワードが設定されていません（config.php）');
            }
            $fails = (int)($_SESSION['login_fails'] ?? 0);
            if ($fails >= 5 && time() - (int)($_SESSION['login_last'] ?? 0) < 300) {
                fail(429, 'ログインの失敗が続いたため、5分ほど待ってからお試しください');
            }
            $pw = (string)(input()['password'] ?? '');
            if (!password_verify($pw, $hash)) {
                $_SESSION['login_fails'] = $fails + 1;
                $_SESSION['login_last']  = time();
                sleep(1);
                fail(401, 'パスワードが違います');
            }
            session_regenerate_id(true);
            $_SESSION = ['admin' => true, 'csrf' => bin2hex(random_bytes(16))];
            out(['csrf' => $_SESSION['csrf']]);
        }

        case 'logout': {
            requirePost();
            requireAdmin(true);
            $_SESSION = [];
            session_destroy();
            out([]);
        }

        case 'admin_state': {
            requireAdmin(false);
            $entries = array_map(fn($e) => [
                'id'     => (int)$e['id'],
                'name'   => $e['name'],
                'choice' => $e['choice'],
                'manual' => (bool)$e['manual'],
            ], db()->query('SELECT id, name, choice, manual FROM lot_entries ORDER BY id')->fetchAll());
            out(['config' => loadConfig(), 'entries' => $entries, 'draws' => (object)drawsMap()]);
        }

        case 'save_config': {
            requirePost();
            requireAdmin(true);
            $in  = input()['config'] ?? [];
            $cfg = [
                'title'          => cleanText($in['title'] ?? '', 40) ?: '忘年会 抽選会',
                'entryOpen'      => !empty($in['entryOpen']),
                'excludeWinners' => !empty($in['excludeWinners']),
                'topFallbackAll' => !empty($in['topFallbackAll']),
                'order'          => ($in['order'] ?? '') === 'lower-first' ? 'lower-first' : 'top-first',
                'top'            => [],
                'lower'          => [],
            ];
            $seen = [];
            foreach (array_slice(is_array($in['top'] ?? null) ? $in['top'] : [], 0, 20) as $p) {
                $id = (string)($p['id'] ?? '');
                if (!preg_match(ID_PATTERN, $id) || isset($seen[$id])) {
                    continue;
                }
                $seen[$id]    = true;
                $cfg['top'][] = ['id' => $id, 'name' => cleanText($p['name'] ?? '', 30), 'note' => cleanText($p['note'] ?? '', 40)];
            }
            foreach (array_slice(is_array($in['lower'] ?? null) ? $in['lower'] : [], 0, 50) as $p) {
                $id = (string)($p['id'] ?? '');
                if (!preg_match(ID_PATTERN, $id) || isset($seen[$id])) {
                    continue;
                }
                $seen[$id]      = true;
                $cfg['lower'][] = ['id' => $id, 'name' => cleanText($p['name'] ?? '', 30), 'count' => max(1, min(3, (int)($p['count'] ?? 1)))];
            }
            $st = db()->prepare('INSERT INTO lot_config (id, data, updated_at) VALUES (1, ?, ?) ON DUPLICATE KEY UPDATE data = VALUES(data), updated_at = VALUES(updated_at)');
            $st->execute([json_encode($cfg, JSON_UNESCAPED_UNICODE), now()]);
            out(['config' => $cfg]);
        }

        case 'add_manual': {
            requirePost();
            requireAdmin(true);
            $c      = loadConfig();
            $in     = input();
            $name   = cleanText($in['name'] ?? '', MAX_NAME);
            $choice = (string)($in['choice'] ?? '');
            if ($name === '') {
                fail(422, 'お名前を入力してください');
            }
            if (!in_array($choice, topIds($c), true)) {
                fail(422, '上位賞品を選んでください');
            }
            $st = db()->prepare('INSERT INTO lot_entries (token_hash, name, choice, manual, created_at, updated_at) VALUES (NULL, ?, ?, 1, ?, ?)');
            $st->execute([$name, $choice, now(), now()]);
            out([]);
        }

        case 'delete_entry': {
            requirePost();
            requireAdmin(true);
            $st = db()->prepare('DELETE FROM lot_entries WHERE id = ?');
            $st->execute([(int)(input()['id'] ?? 0)]);
            out([]);
        }

        case 'draw': {
            requirePost();
            requireAdmin(true);
            $c     = loadConfig();
            $in    = input();
            $prize = findPrize($c, (string)($in['prizeId'] ?? ''));
            if (!$prize) {
                fail(404, '景品が見つかりません');
            }
            $st = db()->prepare('SELECT status, data FROM lot_draws WHERE prize_id = ?');
            $st->execute([$prize['id']]);
            if ($row = $st->fetch()) {
                $d = json_decode($row['data'], true);
                $d['status'] = $row['status'];
                out(['draw' => $d, 'existing' => true]);
            }
            $excluded = is_array($in['excluded'] ?? null) ? $in['excluded'] : [];
            $draw = createDraw($c, $prize, $excluded, false);
            if (!$draw) {
                fail(409, '抽選の対象になる人がいません');
            }
            $draw['status'] = 'draft';
            out(['draw' => $draw]);
        }

        case 'predraw_top': {
            // 上位賞品を先に抽選して未発表のまま保存する（発表は抽選会の最後）
            requirePost();
            requireAdmin(true);
            $c       = loadConfig();
            $done    = [];
            $skipped = [];
            $exists  = array_flip(db()->query('SELECT prize_id FROM lot_draws')->fetchAll(PDO::FETCH_COLUMN));
            foreach (prizeList($c) as $prize) {
                if ($prize['tier'] !== 'top' || isset($exists[$prize['id']])) {
                    continue;
                }
                if (createDraw($c, $prize, [], true)) {
                    $done[] = $prize['name'];
                } else {
                    $skipped[] = $prize['name'];
                }
            }
            out(['done' => $done, 'skipped' => $skipped]);
        }

        case 'reveal': {
            requirePost();
            requireAdmin(true);
            $st = db()->prepare("UPDATE lot_draws SET status = 'revealed', revealed_at = ? WHERE prize_id = ? AND status = 'draft'");
            $st->execute([now(), (string)(input()['prizeId'] ?? '')]);
            out(['updated' => $st->rowCount()]);
        }

        case 'reset': {
            requirePost();
            requireAdmin(true);
            $st = db()->prepare('DELETE FROM lot_draws WHERE prize_id = ?');
            $st->execute([(string)(input()['prizeId'] ?? '')]);
            out([]);
        }

        case 'reset_all': {
            requirePost();
            requireAdmin(true);
            db()->exec('DELETE FROM lot_draws');
            out([]);
        }

        case 'purge': {
            // 会の終了後に、応募者の名前を含むデータをすべて消す
            requirePost();
            requireAdmin(true);
            db()->exec('DELETE FROM lot_draws');
            db()->exec('DELETE FROM lot_entries');
            out([]);
        }

        case 'export': {
            requireAdmin(false);
            $c     = loadConfig();
            $names = [];
            foreach (prizeList($c) as $p) {
                $names[$p['id']] = $p['name'];
            }
            if (($_GET['type'] ?? '') === 'results') {
                $rows = [];
                foreach (drawsMap() as $d) {
                    foreach ($d['winners'] ?? [] as $w) {
                        $rows[] = [
                            $d['prizeName'] ?? '',
                            $d['tier'] === 'top' ? '上位' : '下位',
                            $w['name'],
                            $d['status'] === 'revealed' ? '発表済み' : '未発表',
                            $d['revealedAt'] ? date('Y-m-d H:i:s', intdiv((int)$d['revealedAt'], 1000)) : '',
                        ];
                    }
                }
                sendCsv('results.csv', ['賞品', '区分', '当選者', '状態', '発表日時'], $rows);
            }
            $rows = [];
            $no   = 0;
            foreach (db()->query('SELECT name, choice, manual, created_at, updated_at FROM lot_entries ORDER BY id') as $e) {
                $rows[] = [++$no, $e['name'], $names[$e['choice']] ?? $e['choice'], $e['manual'] ? '手入力' : 'QR', $e['created_at'], $e['updated_at']];
            }
            sendCsv('entries.csv', ['No.', 'お名前', '希望の上位賞品', '登録方法', '応募日時', '更新日時'], $rows);
        }

        default:
            fail(404, '不明な操作です');
    }
} catch (PDOException $e) {
    error_log('[lottery] ' . $e->getMessage());
    fail(500, 'データベースに接続できません。設定を確認してください');
} catch (Throwable $e) {
    error_log('[lottery] ' . $e->getMessage());
    fail(500, 'サーバーでエラーが発生しました');
}
