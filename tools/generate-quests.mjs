#!/usr/bin/env node
// Generates FTB Quests chapters + translations for "Nebesny Archiv".
// Structure files: config/ftbquests/quests/chapters/*.snbt
// Texts:           config/ftbquests/quests/lang/<locale>/{chapter,chapter_group}.snbt
//                                                   /chapters/<filename>.snbt
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chapters, groups } from './quest-data.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const serverQuests = join(root, 'server-test', 'config', 'ftbquests', 'quests');
const instanceQuests = join('C:\\Users\\qwert\\.minecraftx\\instances\\Nebesny Archiv', 'config', 'ftbquests', 'quests');
const itemsFile = join(root, 'research', 'registry-items.txt');
const entitiesFile = join(root, 'research', 'registry-entities.txt');

const errors = [];
const warnings = [];

function hash16(text) {
  return createHash('md5').update(text).digest('hex').slice(0, 16).toUpperCase();
}

function readList(path) {
  if (!existsSync(path)) return null;
  return new Set(readFileSync(path, 'utf8').split(/\r?\n/).map(s => s.trim()).filter(Boolean));
}

const items = readList(itemsFile);
const entities = readList(entitiesFile);
if (!items) warnings.push(`registry item list missing: ${itemsFile}`);
if (!entities) warnings.push(`registry entity list missing: ${entitiesFile}`);

function checkItem(id, where) {
  if (!id || typeof id !== 'string' || !id.includes(':')) {
    errors.push(`${where}: invalid item id "${id}"`);
    return;
  }
  if (items && !items.has(id)) errors.push(`${where}: unknown item "${id}"`);
}

function checkEntity(id, where) {
  if (!id || typeof id !== 'string' || !id.includes(':')) {
    errors.push(`${where}: invalid entity id "${id}"`);
    return;
  }
  if (entities && !entities.has(id)) errors.push(`${where}: unknown entity "${id}"`);
}

// ---------------------------------------------------------------- ids
const questIds = new Map();
for (const chapter of chapters) {
  const seen = new Set();
  for (const quest of chapter.quests) {
    if (seen.has(quest.key)) errors.push(`duplicate quest key ${chapter.filename}:${quest.key}`);
    seen.add(quest.key);
    const globalKey = `${chapter.filename}:${quest.key}`;
    const id = hash16(`nebesnyarchiv:${globalKey}`);
    if (questIds.has(id)) errors.push(`quest id collision for ${globalKey}`);
    questIds.set(globalKey, id);
  }
}

function qid(chapterFilename, questKey) {
  const id = questIds.get(`${chapterFilename}:${questKey}`);
  if (!id) throw new Error(`unknown quest reference ${chapterFilename}:${questKey}`);
  return id;
}

// ---------------------------------------------------------------- snbt
function str(value) {
  // JSON string escaping is valid inside SNBT/JSON5 double-quoted strings.
  return JSON.stringify(value);
}

function snbtChapter(chapter) {
  const chapterId = hash16(`nebesnyarchiv:chapter:${chapter.filename}`);
  const lines = [];
  lines.push('{');
  lines.push('\tdefault_hide_dependency_lines: false');
  lines.push('\tdefault_quest_shape: "circle"');
  lines.push(`\tfilename: ${str(chapter.filename)}`);
  lines.push(`\tgroup: ${str(chapter.group ? hash16(`nebesnyarchiv:group:${chapter.group}`) : '')}`);
  lines.push('\ticon: {');
  lines.push(`\t\tid: ${str(chapter.icon)}`);
  lines.push('\t}');
  lines.push(`\tid: ${str(chapterId)}`);
  lines.push(`\torder_index: ${chapter.order ?? 0}`);
  lines.push('\tprogression_mode: "flexible"');
  if (chapter.subtitleImage) {
    lines.push('\timages: [{');
    lines.push('\t\theight: 3.0d');
    lines.push(`\t\timage: ${str(chapter.subtitleImage)}`);
    lines.push('\t\torder: -1');
    lines.push('\t\trotation: 0.0d');
    lines.push('\t\twidth: 13.0d');
    lines.push('\t\tx: 0.0d');
    lines.push('\t\ty: -3.0d');
    lines.push('\t}]');
  }
  lines.push('\tquests: [');
  chapter.quests.forEach((quest, index) => {
    const questId = qid(chapter.filename, quest.key);
    const where = `${chapter.filename}:${quest.key}`;
    const questIcon = quest.icon || quest.tasks.find(t => t.type === 'item')?.item || 'minecraft:book';
    if (questIcon) checkItem(questIcon, `${where} icon`);
    lines.push('\t\t{');
    const deps = (quest.deps || []).map(dep => {
      const [chapterName, questKey] = dep.includes(':') ? dep.split(':') : [chapter.filename, dep];
      return qid(chapterName, questKey);
    });
    if (deps.length) {
      lines.push(`\t\t\tdependencies: [${deps.map(str).join(', ')}]`);
    }
    lines.push('\t\t\ticon: {');
    lines.push(`\t\t\t\tid: ${str(questIcon)}`);
    lines.push('\t\t\t}');
    lines.push(`\t\t\tid: ${str(questId)}`);
    lines.push(`\t\t\tmin_width: ${quest.minWidth ?? 220}`);
    if (quest.rewards?.length) {
      lines.push('\t\t\trewards: [');
      quest.rewards.forEach((reward, ri) => {
        const rewardId = hash16(`nebesnyarchiv:${chapter.filename}:${quest.key}:reward:${ri}`);
        if (reward.type === 'xp') {
          lines.push('\t\t\t\t{');
          lines.push(`\t\t\t\t\tid: ${str(rewardId)}`);
          lines.push('\t\t\t\t\ttype: "xp"');
          lines.push(`\t\t\t\t\txp: ${reward.xp}`);
          lines.push('\t\t\t\t}');
        } else if (reward.type === 'item') {
          checkItem(reward.item, `${where} reward ${ri}`);
          lines.push('\t\t\t\t{');
          lines.push(`\t\t\t\t\tcount: ${reward.count ?? 1}`);
          lines.push(`\t\t\t\t\tid: ${str(rewardId)}`);
          lines.push('\t\t\t\t\titem: {');
          lines.push('\t\t\t\t\t\tcount: 1');
          lines.push(`\t\t\t\t\t\tid: ${str(reward.item)}`);
          lines.push('\t\t\t\t\t}');
          lines.push('\t\t\t\t\ttype: "item"');
          lines.push('\t\t\t\t}');
        } else {
          errors.push(`${where}: unsupported reward type ${reward.type}`);
        }
      });
      lines.push('\t\t\t]');
    }
    lines.push(`\t\t\tshape: ${str(quest.shape || 'circle')}`);
    lines.push(`\t\t\tsize: ${(quest.size ?? 1.0).toFixed(1)}d`);
    lines.push('\t\t\ttasks: [');
    quest.tasks.forEach((task, ti) => {
      const taskId = hash16(`nebesnyarchiv:${chapter.filename}:${quest.key}:task:${ti}`);
      lines.push('\t\t\t\t{');
      if (task.type === 'item') {
        checkItem(task.item, `${where} task ${ti}`);
        lines.push(`\t\t\t\t\tcount: ${task.count ?? 1}`);
        lines.push(`\t\t\t\t\tid: ${str(taskId)}`);
        lines.push('\t\t\t\t\titem: {');
        lines.push('\t\t\t\t\t\tcount: 1');
        lines.push(`\t\t\t\t\t\tid: ${str(task.item)}`);
        lines.push('\t\t\t\t\t}');
        lines.push('\t\t\t\t\ttype: "item"');
      } else if (task.type === 'kill') {
        checkEntity(task.entity, `${where} task ${ti}`);
        lines.push(`\t\t\t\t\tentity: ${str(task.entity)}`);
        lines.push(`\t\t\t\t\tid: ${str(taskId)}`);
        lines.push('\t\t\t\t\ttype: "kill"');
        lines.push(`\t\t\t\t\tvalue: ${task.value ?? 1}`);
      } else if (task.type === 'dimension') {
        lines.push(`\t\t\t\t\tdimension: ${str(task.dimension)}`);
        lines.push(`\t\t\t\t\tid: ${str(taskId)}`);
        lines.push('\t\t\t\t\ttype: "dimension"');
      } else if (task.type === 'checkmark') {
        lines.push(`\t\t\t\t\tid: ${str(taskId)}`);
        lines.push('\t\t\t\t\ttype: "checkmark"');
      } else {
        errors.push(`${where}: unsupported task type ${task.type}`);
      }
      lines.push('\t\t\t\t}');
    });
    lines.push('\t\t\t]');
    if (quest.optional) lines.push('\t\t\toptional: true');
    lines.push(`\t\t\tx: ${(quest.x ?? index * 2).toFixed(1)}d`);
    lines.push(`\t\t\ty: ${(quest.y ?? 0).toFixed(1)}d`);
    lines.push('\t\t}');
  });
  lines.push('\t]');
  lines.push('}');
  return lines.join('\n') + '\n';
}

function snbtData() {
  return `{
\tdefault_autoclaim_rewards: "disabled"
\tdefault_consume_items: false
\tdefault_quest_disable_jei: false
\tdefault_quest_shape: "circle"
\tdefault_reward_team: false
\tdetection_delay: 60
\tdisable_gui: false
\tdrop_loot_crates: false
\temergency_items_cooldown: 300
\tgrid_scale: 0.5d
\ticon: {
\t\tid: "ftbquests:book"
\t}
\tlock_message: ""
\tloot_crate_no_drop: {
\t\tboss: 0
\t\tmonster: 600
\t\tpassive: 4000
\t}
\tpause_game: false
\tprogression_mode: "flexible"
\tshow_lock_icons: true
\tversion: 13
}
`;
}

function snbtChapterGroups() {
  const lines = ['{', '\tchapter_groups: ['];
  for (const group of groups) {
    lines.push('\t\t{');
    lines.push(`\t\t\tid: ${str(hash16(`nebesnyarchiv:group:${group.key}`))}`);
    lines.push('\t\t}');
  }
  lines.push('\t]');
  lines.push('}');
  return lines.join('\n') + '\n';
}

function snbtChapterLangTitles() {
  const lines = ['{'];
  for (const chapter of chapters) {
    const id = hash16(`nebesnyarchiv:chapter:${chapter.filename}`);
    lines.push(`\t${str(`chapter.${id}.chapter_subtitle`)}: [${str(chapter.subtitle || '')}]`);
    lines.push(`\t${str(`chapter.${id}.title`)}: ${str(chapter.title)}`);
  }
  lines.push('}');
  return lines.join('\n') + '\n';
}

function snbtChapterGroupLang() {
  const lines = ['{'];
  for (const group of groups) {
    const id = hash16(`nebesnyarchiv:group:${group.key}`);
    lines.push(`\t${str(`chapter_group.${id}.title`)}: ${str(group.title)}`);
  }
  lines.push('}');
  return lines.join('\n') + '\n';
}

function snbtChapterLang(chapter) {
  const lines = ['{'];
  for (const quest of chapter.quests) {
    const id = qid(chapter.filename, quest.key);
    const desc = (quest.desc || []).map(str).join(', ');
    lines.push(`\t${str(`quest.${id}.quest_desc`)}: [${desc}]`);
    lines.push(`\t${str(`quest.${id}.title`)}: ${str(quest.title)}`);
  }
  lines.push('}');
  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------- write
function writeSet(baseDir) {
  const chaptersDir = join(baseDir, 'chapters');
  if (existsSync(chaptersDir)) rmSync(chaptersDir, { recursive: true, force: true });
  mkdirSync(chaptersDir, { recursive: true });

  writeFileSync(join(baseDir, 'data.snbt'), snbtData(), 'utf8');
  writeFileSync(join(baseDir, 'chapter_groups.snbt'), snbtChapterGroups(), 'utf8');
  for (const chapter of chapters) {
    writeFileSync(join(chaptersDir, `${chapter.filename}.snbt`), snbtChapter(chapter), 'utf8');
  }

  for (const locale of ['en_us', 'ru_ru']) {
    const langDir = join(baseDir, 'lang', locale);
    const langChaptersDir = join(langDir, 'chapters');
    if (existsSync(langChaptersDir)) rmSync(langChaptersDir, { recursive: true, force: true });
    mkdirSync(langChaptersDir, { recursive: true });
    writeFileSync(join(langDir, 'chapter.snbt'), snbtChapterLangTitles(), 'utf8');
    writeFileSync(join(langDir, 'chapter_group.snbt'), snbtChapterGroupLang(), 'utf8');
    for (const chapter of chapters) {
      writeFileSync(join(langChaptersDir, `${chapter.filename}.snbt`), snbtChapterLang(chapter), 'utf8');
    }
  }
}

// ---------------------------------------------------------------- report
const totalQuests = chapters.reduce((n, c) => n + c.quests.length, 0);
const totalTasks = chapters.reduce((n, c) => n + c.quests.reduce((m, q) => m + q.tasks.length, 0), 0);

if (errors.length) {
  console.error(`VALIDATION FAILED (${errors.length})`);
  for (const error of errors.slice(0, 200)) console.error('  - ' + error);
  if (errors.length > 200) console.error(`  ... and ${errors.length - 200} more`);
  process.exit(2);
}

writeSet(serverQuests);
writeSet(instanceQuests);

console.log(`OK: ${chapters.length} chapters, ${totalQuests} quests, ${totalTasks} tasks`);
console.log(`items registry: ${items ? items.size : 'missing'}; entities registry: ${entities ? entities.size : 'missing'}`);
console.log(`server:   ${serverQuests}`);
console.log(`instance: ${instanceQuests}`);
if (warnings.length) {
  console.log('WARNINGS:');
  for (const warning of warnings) console.log('  - ' + warning);
}
