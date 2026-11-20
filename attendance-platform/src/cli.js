#!/usr/bin/env node
'use strict';
/*
 * أوامر الإدارة من الخادم:
 *   node src/cli.js owner:create <email> [name]   إنشاء مالك المنصة أو إعادة تعيين كلمة مروره
 *   node src/cli.js owner:reset-2fa <email>        إلغاء التحقق بخطوتين عند فقدان الجوال
 * داخل Docker:
 *   docker compose exec app node src/cli.js owner:create you@example.com "اسمك"
 */
const [cmd, ...args] = process.argv.slice(2);

if (cmd === 'owner:create') {
  const { createOwner } = require('./owner');
  try {
    const pass = createOwner(args[0], args.slice(1).join(' '));
    console.log(`Owner: ${args[0]}`);
    console.log(`Temporary password: ${pass}`);
    console.log('Log in at /owner and change it.');
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
} else if (cmd === 'owner:reset-2fa') {
  try {
    require('./owner').resetOwner2fa(args[0]);
    console.log(`Two-step verification reset for ${args[0]}. Set it up again at the next login.`);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
} else if (cmd === 'owner:count') {
  console.log(require('./db').prepare('SELECT COUNT(*) AS n FROM platform_admins').get().n);
} else {
  console.log('Usage: node src/cli.js owner:create <email> [name] | owner:reset-2fa <email>');
  process.exit(cmd ? 1 : 0);
}
