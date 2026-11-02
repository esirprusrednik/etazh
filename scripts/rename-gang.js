// Админское переименование банды.
// Запуск на сервере:
//   docker compose -f /opt/etazh/docker-compose.yml exec app node --no-warnings scripts/rename-gang.js "Старое название" "Новое название"
// Регистр в старом названии не важен. Участники увидят новое имя сразу, ссылка-приглашение не меняется.
const { config } = require('../server/config');
const U = require('../server/util');
const { openDb } = require('../server/db');

const [from, to] = process.argv.slice(2).map((s) => (s || '').trim());
if (!from || !to) { console.error('Использование: rename-gang.js "Старое название" "Новое название"'); process.exit(1); }
const name = U.cleanText(to, 30);
if (name.length < 2) { console.error('Новое название: от 2 до 30 символов.'); process.exit(1); }
const prob = U.moderationProblem(name);
if (prob) { console.error(prob); process.exit(1); }

const db = openDb(config.dbPath);
const low = (s) => s.toLocaleLowerCase('ru').replace(/ё/g, 'е'); // «ё» и «е» — одно и то же
const all = db.prepare('SELECT id, name FROM gangs').all();
const found = all.filter((g) => low(g.name) === low(from));
if (!found.length) {
  const like = all.filter((g) => low(g.name).includes(low(from).slice(0, 5))).map((g) => `«${g.name}»`);
  console.error(`Банда «${from}» не найдена.${like.length ? ' Похожие: ' + like.join(', ') : ''}`);
  process.exit(1);
}
if (found.length > 1) { console.error(`Банд с таким названием несколько (id: ${found.map((g) => g.id).join(', ')}).`); process.exit(1); }
if (all.some((g) => g.id !== found[0].id && low(g.name) === low(name))) { console.error(`Банда «${name}» уже есть.`); process.exit(1); }
db.prepare('UPDATE gangs SET name = ? WHERE id = ?').run(name, found[0].id);
console.log(`Готово: «${found[0].name}» → «${name}»`);
