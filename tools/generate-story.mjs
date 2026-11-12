// Generates the story layer for "Nebesny Archiv":
//
//   1. Easy NPC presets (.npc.snbt) with the dialogue trees.
//   2. FTB Quests quest tasks of the compat mod's "easy_npc_task" type, so that
//      reading an NPC dialog counts as completing a quest task.
//
// Both artifacts have to agree on ids, so everything is derived from one place:
//
//   * the Easy NPC dialog id is derived from the dialog Label
//   * the FTB Quests quest id comes from tools/quest-id.mjs
//
// The compat mod stores the quest rules on the NPC entity, so the rules are
// written into the preset's entity data under the tag "easynpc_ftbq_rules".
//
// Usage: node tools/generate-story.mjs
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { storyNodes } from './story-data.mjs';
import { questId } from './quest-id.mjs';
import { chapters } from './quest-data.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

// Where the generated presets are written. The server reads them from
// config/easy_npc/preset and imports them with
//   /easy_npc preset import custom <name> <x> <y> <z>
// The client gets them too so the preset browser can show them.
const targets = [
  join(root, 'packwiz', 'config', 'easy_npc', 'preset'),
  join(root, 'packwiz-lite', 'config', 'easy_npc', 'preset'),
  join(root, 'server-test', 'config', 'easy_npc', 'preset'),
  'C:\\Users\\qwert\\.minecraftx\\instances\\Nebesny Archiv\\config\\easy_npc\\preset',
  'C:\\Users\\qwert\\.minecraftx\\instances\\Nebesny Archiv Lite\\config\\easy_npc\\preset',
];

const errors = [];
const warnings = [];

/** FTB Quests quest id in the %016X form the compat mod expects. */
function questCodeString(chapterFile, questKey) {
  return questId(`nebesnyarchiv:${chapterFile}:${questKey}`);
}

// ---------------------------------------------------------------- presets --

/**
 * Easy NPC derives a dialog's UUID from its label:
 *   UUID.nameUUIDFromBytes(label.getBytes())
 * That is a name-based (v3) UUID: MD5 of the label with version/variant bits
 * set. We reproduce it here so quest rules can point at a dialog by label.
 */
function dialogUuid(label) {
  const md5 = createHash('md5').update(label, 'utf8').digest();
  md5[6] = (md5[6] & 0x0f) | 0x30; // version 3
  md5[8] = (md5[8] & 0x3f) | 0x80; // IETF variant
  const hex = md5.toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

function snbtString(value) {
  return JSON.stringify(value);
}

/** Joins SNBT list elements with the commas SNBT requires between them. */
function snbtList(elements) {
  return `[\n${elements.join(',\n')}\n]`;
}

/**
 * Dialog labels are the identity of a dialog: Easy NPC derives the dialog UUID
 * from the label (UUID.nameUUIDFromBytes), and the FTB Quests compat mod
 * matches a quest task either by that UUID or by the label. Two NPCs would
 * otherwise share the label "greet" and the same UUID, so every label is
 * namespaced with the NPC id.
 */
function dialogLabel(nodeId, label) {
  return `${nodeId}_${label}`;
}

function snbtDialog(node, entry) {
  const lines = [];
  lines.push('{');
  lines.push(`\tLabel: ${snbtString(dialogLabel(node.id, entry.label))},`);
  lines.push(`\tName: ${snbtString(entry.name)},`);
  lines.push(`\tPriority: ${entry.priority ?? 5},`);
  lines.push(`\tTexts: ${snbtList(entry.texts.map((text) => `\t{Text: ${snbtString(text)}}`))},`);
  if (entry.buttons?.length) {
    const buttons = entry.buttons.map((button) => {
      const buttonLines = [];
      buttonLines.push('\t{');
      buttonLines.push(`\t\tLabel: ${snbtString(dialogLabel(node.id, button.label))},`);
      buttonLines.push(`\t\tName: ${snbtString(button.name)}`);
      if (button.actions?.length) {
        const actions = button.actions.map((action) => {
          const cmd = action.type === 'OPEN_NAMED_DIALOG'
            ? dialogLabel(node.id, action.cmd)
            : action.cmd;
          return `\t\t{\n\t\t\tCmd: ${snbtString(cmd)},\n\t\t\tType: ${snbtString(action.type)}\n\t\t}`;
        });
        buttonLines.push(`,\n\t\tActions: ${snbtList(actions)}`);
      }
      buttonLines.push('\t}');
      return buttonLines.join('\n');
    });
    lines.push(`\tButtons: ${snbtList(buttons)}`);
  }
  lines.push('}');
  return lines.join('\n');
}

function snbtPreset(node) {
  const rules = [];
  for (const rule of node.rules) {
    const [chapterFile, questKey] = rule.quest.split(':');
    const id = questCodeString(chapterFile, questKey);
    rules.push({
      questId: id,
      dialogId: dialogLabel(node.id, rule.dialog),
      priority: rule.priority ?? 5,
      condition: rule.condition,
    });
  }

  const lines = [];
  lines.push('{');
  lines.push('\tPresetMetadata:{');
  lines.push('\t\tauthor:"Nebesny Archiv Team",');
  lines.push('\t\tcategory:"Story",');
  lines.push('\t\tdescription:"Story NPC of the Nebesny Archiv campaign.",');
  lines.push('\t\tentityTypeId:"easy_npc:humanoid",');
  lines.push(`\t\tname:${snbtString(node.name)},`);
  lines.push(`\t\tvariantType:${snbtString(node.skin)},`);
  lines.push('\t\tversion:"1.0.0"');
  lines.push('\t},');
  lines.push('\tdata:{');
  lines.push(`\t\tCustomName:${snbtString(JSON.stringify({ color: node.color, text: node.name }))},`);
  // Right-clicking the NPC opens its default dialog.
  lines.push('\t\tActionData:{');
  lines.push('\t\t\tActionEventSet:{');
  lines.push('\t\t\t\tON_INTERACTION:[{');
  lines.push('\t\t\t\t\tType:"OPEN_DEFAULT_DIALOG"');
  lines.push('\t\t\t\t}]');
  lines.push('\t\t\t}');
  lines.push('\t\t},');
  const dialogs = node.lines.map((entry) => snbtDialog(node, entry));
  lines.push(`\t\tDialogData:{`);
  lines.push(`\t\t\tDialogDataSet: ${snbtList(dialogs)},`);
  lines.push('\t\t\tType:"STANDARD"');
  lines.push('\t\t},');
  lines.push('\t\tInvulnerable:1b,');
  lines.push('\t\tObjectiveData:{');
  lines.push('\t\t\tObjectiveDataSet:[{');
  lines.push('\t\t\t\tType:"LOOK_AT_PLAYER"');
  lines.push('\t\t\t}]');
  lines.push('\t\t},');
  lines.push('\t\tPersistenceRequired:1b,');
  lines.push(`\t\tVariantType:${snbtString(node.skin)},`);
  const ruleEntries = rules.map((rule) => {
    const ruleLines = [];
    ruleLines.push('\t\t\t{');
    ruleLines.push(`\t\t\t\tcondition:${snbtString(rule.condition)},`);
    ruleLines.push(`\t\t\t\tdialogId:${snbtString(rule.dialogId)},`);
    ruleLines.push(`\t\t\t\tpriority:${rule.priority},`);
    ruleLines.push(`\t\t\t\tquestId:${snbtString(rule.questId)}`);
    ruleLines.push('\t\t\t}');
    return ruleLines.join('\n');
  });
  lines.push('\t\teasynpc_ftbq_rules:{');
  lines.push(`\t\t\tfallbackDialogId:${snbtString(dialogLabel(node.id, node.lines[0].label))},`);
  lines.push(`\t\t\trules: ${snbtList(ruleEntries)}`);
  lines.push('\t\t},');
  // The entity type id is mandatory: Easy NPC reads it from here to know which
  // entity to spawn.
  lines.push('\t\tid:"easy_npc:humanoid"');
  lines.push('\t}');
  lines.push('}');
  return lines.join('\n') + '\n';
}

// ------------------------------------------------------------ validation --

const knownQuests = new Set();
for (const chapter of chapters) {
  for (const quest of chapter.quests) {
    knownQuests.add(`${chapter.filename}:${quest.key}`);
  }
}

for (const node of storyNodes) {
  const labels = new Set();
  for (const entry of node.lines) {
    if (labels.has(entry.label)) errors.push(`${node.id}: duplicate dialog label "${entry.label}"`);
    labels.add(entry.label);
  }
  for (const rule of node.rules) {
    if (!knownQuests.has(rule.quest)) errors.push(`${node.id}: rule references unknown quest "${rule.quest}"`);
    if (!labels.has(rule.dialog)) errors.push(`${node.id}: rule references unknown dialog "${rule.dialog}"`);
    if (!['COMPLETED', 'STARTED', 'STARTABLE', 'NOT_COMPLETED'].includes(rule.condition)) {
      errors.push(`${node.id}: bad condition "${rule.condition}"`);
    }
  }
  for (const entry of node.lines) {
    for (const button of entry.buttons ?? []) {
      for (const action of button.actions ?? []) {
        if (action.type === 'OPEN_NAMED_DIALOG' && !labels.has(action.cmd)) {
          errors.push(`${node.id}: button "${button.label}" opens unknown dialog "${action.cmd}"`);
        }
      }
    }
  }
}

// The quests ask the player to talk to an NPC. Every npc_dialog task has to
// point at a dialog that actually exists, otherwise the quest can never be
// completed.
const dialogLabels = new Set();
for (const node of storyNodes) {
  for (const entry of node.lines) {
    dialogLabels.add(dialogLabel(node.id, entry.label));
  }
}
for (const chapter of chapters) {
  for (const quest of chapter.quests) {
    for (const task of quest.tasks) {
      if (task.type !== 'npc_dialog') continue;
      if (!dialogLabels.has(task.dialog)) {
        errors.push(`${chapter.filename}:${quest.key}: npc_dialog "${task.dialog}" has no matching dialog`);
      }
    }
  }
}

if (errors.length) {
  console.error(`VALIDATION FAILED (${errors.length})`);
  for (const error of errors) console.error(error);
  process.exit(2);
}

// ----------------------------------------------------------------- output --

for (const target of targets) {
  mkdirSync(target, { recursive: true });
  // Remove stale presets from previous runs so renamed nodes do not linger.
  for (const file of ['vesta.npc.snbt', 'miya.npc.snbt']) {
    const path = join(target, file);
    if (existsSync(path)) rmSync(path, { force: true });
  }
  for (const node of storyNodes) {
    writeFileSync(join(target, `${node.id}.npc.snbt`), snbtPreset(node), 'utf8');
  }
  console.log('wrote', target);
}

// Report the import commands for the server console.
console.log('\nImport the story NPCs on the server console (run once per world):');
for (const node of storyNodes) {
  console.log(`  /easy_npc preset import custom ${node.id} <x> <y> <z>`);
}

console.log(`\nOK: ${storyNodes.length} story NPCs, ${storyNodes.reduce((n, node) => n + node.lines.length, 0)} dialogs`);
for (const warning of warnings) console.log('warn:', warning);
