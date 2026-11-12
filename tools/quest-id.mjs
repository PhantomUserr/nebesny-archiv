// Stable quest object IDs for "Nebesny Archiv".
//
// FTB Quests stores every quest/chapter/task/reward ID as a LONG and renders it
// as %016X (see QuestObjectBase.getCodeString). When reading a quest file it
// parses the "id" string back with Long.parseLong(id, 16):
//
//   BaseQuestFile.readID(Tag)  -> Long.parseLong(id, 16)
//   QuestObjectBase.parseCodeString(id) -> Long.parseLong(id, 16)
//
// Long.parseLong rejects values above Long.MAX_VALUE, so an ID whose top hex
// digit is 8..F cannot be read back. FTB then throws the ID away and assigns a
// RANDOM one (readID -> newID()), which silently breaks:
//
//   - quest dependencies (the target resolves to 0 and gets dropped),
//   - the quest <-> translation mapping (lang keys are keyed by the ID),
//   - Easy NPC x FTB Quests Compat rules, which look quests up by ID.
//
// An MD5 prefix used verbatim overflows for ~51% of all IDs, so we mask the
// value down to 63 bits: 15 hex digits of entropy (< 2^60) which always parses,
// and we format it exactly like FTB does (%016X) so files stay byte-stable
// across reloads.
import { createHash } from 'node:crypto';

const MAX_SIGNED_63 = (1n << 63n) - 1n;

/**
 * Deterministic 16-char uppercase hex ID in the range FTB Quests can parse.
 * @param {string} text
 * @returns {string}
 */
export function questId(text) {
  // 15 hex digits = 60 bits, always well below Long.MAX_VALUE.
  const value = BigInt('0x' + createHash('md5').update(text).digest('hex').slice(0, 15));
  if (value > MAX_SIGNED_63) {
    throw new Error(`questId overflow for "${text}"`);
  }
  return value.toString(16).toUpperCase().padStart(16, '0');
}
