'use strict';
/*
 * نسخ احتياطي تلقائي لقاعدة البيانات داخل DATA_DIR/backups
 * - نسخة عند التشغيل ثم كل BACKUP_INTERVAL_HOURS ساعة (افتراضياً 24)
 * - الاحتفاظ بآخر BACKUP_KEEP نسخة (افتراضياً 14)
 * - BACKUP_INTERVAL_HOURS=0 لتعطيله
 * يستخدم واجهة النسخ الآمن في SQLite فلا يوقف المنصة أثناء النسخ.
 */
const fs = require('fs');
const path = require('path');
const db = require('./db');

const dir = path.join(process.env.DATA_DIR || path.join(__dirname, '..', 'data'), 'backups');
const hours = Number(process.env.BACKUP_INTERVAL_HOURS ?? 24);
const keep = Math.max(1, Number(process.env.BACKUP_KEEP) || 14);

async function runBackup() {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const file = path.join(dir, `attendance-${stamp}.db`);
  await db.backup(file);
  const old = fs.readdirSync(dir).filter((f) => /^attendance-.*\.db$/.test(f)).sort().reverse().slice(keep);
  for (const f of old) fs.rmSync(path.join(dir, f), { force: true });
  console.log(`نسخة احتياطية: ${path.basename(file)}`);
  return file;
}

function schedule() {
  if (!hours) return () => {};
  const safe = () => runBackup().catch((e) => console.error('فشل النسخ الاحتياطي:', e.message));
  const first = setTimeout(safe, 60 * 1000); // بعد دقيقة من التشغيل
  const timer = setInterval(safe, hours * 3600e3);
  first.unref();
  timer.unref();
  return () => { clearTimeout(first); clearInterval(timer); };
}

module.exports = { runBackup, schedule };

if (require.main === module) runBackup().then((f) => console.log(f));
