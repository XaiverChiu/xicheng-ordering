/**
 * 数据访问入口：按配置选择驱动
 * 两个驱动实现同一套方法，业务层不感知底层是 MySQL 还是内存
 */
import config from '../config.js';
import { createMysqlDriver } from './mysql.js';
import { createMemoryDriver } from './memory.js';

let driver = null;

export async function initDb({ log = console, allowFallback = true } = {}) {
  if (driver) return driver;

  if (config.db.driver === 'memory') {
    driver = await createMemoryDriver({ log });
    return driver;
  }

  try {
    driver = await createMysqlDriver({ log });
    return driver;
  } catch (e) {
    if (!allowFallback) throw e;
    log.error?.('[db] MySQL 连接失败：' + e.message);
    log.warn?.('[db] 已自动降级为内存驱动（数据不会进入 MySQL；装好 MySQL 后重启并设置 DB_DRIVER=mysql 即可）');
    driver = await createMemoryDriver({ log });
    return driver;
  }
}

export function db() {
  if (!driver) throw new Error('数据库尚未初始化，请先调用 initDb()');
  return driver;
}

export async function closeDb() {
  if (driver) {
    await driver.close();
    driver = null;
  }
}

export default { initDb, db, closeDb };
