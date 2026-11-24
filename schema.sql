-- 忘年会 抽選会 テーブル定義（MySQL 5.7 以上 / MariaDB 10.3 以上）
-- 文字コード：utf8mb4

CREATE TABLE IF NOT EXISTS lot_config (
  id         TINYINT UNSIGNED NOT NULL PRIMARY KEY,
  data       MEDIUMTEXT       NOT NULL COMMENT '景品・受付設定（JSON）',
  updated_at DATETIME         NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS lot_entries (
  id         INT UNSIGNED     NOT NULL AUTO_INCREMENT PRIMARY KEY,
  token_hash CHAR(64)         NULL     COMMENT '端末トークンのSHA-256（手入力はNULL）',
  name       VARCHAR(50)      NOT NULL,
  choice     VARCHAR(40)      NOT NULL COMMENT '希望する上位賞品のID',
  manual     TINYINT(1)       NOT NULL DEFAULT 0,
  created_at DATETIME         NOT NULL,
  updated_at DATETIME         NOT NULL,
  UNIQUE KEY uq_token (token_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS lot_images (
  prize_id   VARCHAR(40)      NOT NULL PRIMARY KEY,
  mime       VARCHAR(40)      NOT NULL,
  data       MEDIUMBLOB       NOT NULL COMMENT '景品の画像（JPEG）',
  updated_at DATETIME         NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS lot_draws (
  prize_id    VARCHAR(40)               NOT NULL PRIMARY KEY,
  status      ENUM('draft','revealed')  NOT NULL,
  data        MEDIUMTEXT                NOT NULL COMMENT 'あみだくじと当選者（JSON）',
  created_at  DATETIME                  NOT NULL,
  revealed_at DATETIME                  NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
