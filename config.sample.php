<?php
// このファイルを config.php という名前でコピーし、値を書き換えてください。
// config.php は .htaccess で外部から読めないようにしています。

return [
    'db' => [
        'host'    => 'localhost',
        'port'    => 3306,
        'name'    => 'lottery',
        'user'    => 'lottery_user',
        'pass'    => 'CHANGE_ME',
    ],

    // 幹事用パスワードのハッシュ。次のコマンドで作成して貼り付けてください。
    //   php -r "echo password_hash('ここにパスワード', PASSWORD_DEFAULT), PHP_EOL;"
    'admin_password_hash' => '',

    // Cookie の Secure 属性。null なら HTTPS かどうかで自動判定します。
    'cookie_secure' => null,
];
