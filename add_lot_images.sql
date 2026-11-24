CREATE TABLE IF NOT EXISTS lot_images (
  prize_id   VARCHAR(40)      NOT NULL PRIMARY KEY,
  mime       VARCHAR(40)      NOT NULL,
  data       MEDIUMBLOB       NOT NULL COMMENT '景品の画像（JPEG）',
  updated_at DATETIME         NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
