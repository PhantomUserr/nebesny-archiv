// Общие помощники для описания квестов.
// Вынесены отдельно, чтобы новые главы (tools/quest-data-extra.mjs) и основной
// список (tools/quest-data.mjs) пользовались одними и теми же формами.

/** Задача: иметь предмет. */
export const I = (item, count = 1) => ({ type: 'item', item, count });
/** Задача: убить моба. */
export const K = (entity, value = 1) => ({ type: 'kill', entity, value });
/** Задача: побывать в измерении. */
export const D = (dimension) => ({ type: 'dimension', dimension });
/** Задача: просто отметить. */
export const C = () => ({ type: 'checkmark' });
/**
 * Задача: поговорить с NPC.
 * Идентификатор — метка диалога Easy NPC, см. tools/story-data.mjs.
 */
export const N = (dialog) => ({ type: 'npc_dialog', dialog });
/** Награда: опыт. */
export const XP = (xp) => ({ type: 'xp', xp });

/**
 * Квест.
 * @param {string} key уникальный ключ внутри главы
 * @param {string} title заголовок
 * @param {string[]} desc описание (строки)
 * @param {Array} tasks задачи
 * @param {Object} opts доп. поля: deps, x, y, rewards, icon, shape, size, optional
 */
export const Q = (key, title, desc, tasks, opts = {}) => ({
  key,
  title,
  desc: Array.isArray(desc) ? desc : [desc],
  tasks,
  rewards: opts.rewards || [],
  icon: opts.icon,
  deps: opts.deps || [],
  x: opts.x,
  y: opts.y,
  shape: opts.shape,
  size: opts.size,
  optional: opts.optional || false,
});
