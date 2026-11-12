// Story content for "Nebesny Archiv" — the pilot act.
//
// Structure of a story node:
//   id       unique key, also used as the NPC's dialog label prefix
//   name     display name of the NPC
//   skin     Easy NPC variant type (see easy_npc assets)
//   lines    dialog entries; each becomes one Easy NPC dialog
//   rules    quest-linked dialogue: which FTB quest unlocks which dialog
//
// The Easy NPC preset format (see Easy NPC wiki "Preset"):
//
//   PresetMetadata:{ author, category, description, entityTypeId, name, variantType, version }
//   data:{ CustomName, DialogData:{ DialogDataSet:[...], Type:"STANDARD" }, ... }
//
// A dialog entry supports:
//   Label     stable id of the dialog (used by the quest rules)
//   Name      human readable title
//   Priority  higher wins when several dialogs match
//   Texts     array of { Text } -> the spoken lines
//   Buttons   array of { Label, Name, Actions:[{ Type, Cmd }] }
//
// The quest rules live in the compat mod and are stored on the NPC entity under
// the tag "easynpc_ftbq_rules" as:
//
//   { rules:[{ questId, dialogId, priority, condition }], fallbackDialogId }
//
// condition is one of COMPLETED / STARTED / STARTABLE / NOT_COMPLETED.
// questId is the FTB Quests quest id in its %016X form.
// dialogId is the Easy NPC dialog id; by convention we use the dialog Label.
//
// Buttons may run commands. In this pack they are used for sounds and for
// handing out quest hints, never for anything that changes world state, so
// they are safe to run from a client-triggered dialog.

/**
 * @typedef {Object} StoryNode
 * @property {string} id
 * @property {string} name
 * @property {string} skin
 * @property {string} color
 * @property {Array} lines
 * @property {Array} rules
 */

/** @type {StoryNode[]} */
export const storyNodes = [
  {
    id: 'vesta',
    name: 'Веста Урбан',
    skin: 'KNIGHT_02',
    color: '#D8C49B',
    lines: [
      {
        label: 'greet',
        name: 'Первая встреча',
        priority: 5,
        texts: [
          'Стоп. Не дёргайся — я не Стиратель. Хотя по виду ты сейчас похож на страницу, которую забыли внести в Указатель. Это обидно, но поправимо.',
          'Я — Веста Урбан. Старший смотритель Каталога. Ну, теперь уже «бывший старший смотритель», потому что Каталога у нас больше нет. Есть обломки, есть я, и есть ты.',
          'Прежде чем мы начнём: знаешь ли ты, что за Архив? Не торопись. Плохой ответ хуже, чем никакого.',
        ],
        buttons: [
          {
            label: 'about_archive',
            name: 'Что такое Небесный Архив?',
            actions: [
              { type: 'OPEN_NAMED_DIALOG', cmd: 'about_archive' },
            ],
          },
          {
            label: 'what_now',
            name: 'Что делать-то теперь?',
            actions: [
              { type: 'OPEN_NAMED_DIALOG', cmd: 'what_now' },
            ],
          },
          {
            label: 'bye',
            name: 'Позже.',
            actions: [],
          },
        ],
      },
      {
        label: 'about_archive',
        name: 'О Небесном Архиве',
        priority: 5,
        texts: [
          'Небесный Архив — это флотилия. Сорок кораблей, и каждый был библиотекой. Мы не воевали и не торговали. Мы собирали знание — всё, что мир ещё помнит, — пока помнит.',
          'Адрес — номер, полка, подпись. Пока запись не внесена в Указатель, вещи как будто нет. Механизм без инструкции — просто железо. Знание без адреса — просто бумага.',
          'Всё это было в Якоре. В его Сердце — восемь миллионов адресов. Потом был Год Нырка, и мы полетели вниз. Ветер, гроза, и Сердце дало трещину.',
        ],
        buttons: [
          {
            label: 'greet',
            name: 'Назад.',
            actions: [
              { type: 'OPEN_NAMED_DIALOG', cmd: 'greet' },
            ],
          },
        ],
      },
      {
        label: 'what_now',
        name: 'С чего начать',
        priority: 5,
        texts: [
          'Начнём с простого. Упади с дерева — мир не отличается от обычного. Сделай верстак, срубь несколько стволов и не геройствуй.',
          'А геройство оставь на потом. Тот, кто геройствует первым, обычно первым и оказывается в Стирателях.',
          'И держи Указатель под рукой. Первое, что тебе пригодится, — подсказка. Я подскажу, что делать. Иди.',
        ],
        buttons: [
          {
            label: 'greet',
            name: 'Назад.',
            actions: [
              { type: 'OPEN_NAMED_DIALOG', cmd: 'greet' },
            ],
          },
          {
            label: 'first_quest',
            name: 'Что мне сделать прямо сейчас?',
            actions: [
              { type: 'OPEN_NAMED_DIALOG', cmd: 'first_quest' },
            ],
          },
        ],
      },
      {
        label: 'first_quest',
        name: 'Первое дело',
        priority: 5,
        texts: [
          'Дерево. Восемь стволов. Потом — верстак из досок. Если руки кривые — не беда, Указатель подскажет, что делать, когда откроешь книгу квестов.',
          'Кстати. Мия просила, чтобы ты заглянул к ней. Она там, у обломков. Болтливая, но полезная: знает, где что лежит.',
        ],
        buttons: [
          {
            label: 'greet',
            name: 'Понял.',
            actions: [
              { type: 'OPEN_NAMED_DIALOG', cmd: 'greet' },
            ],
          },
        ],
      },
      {
        label: 'after_wood',
        name: 'Ты вернулся',
        priority: 20,
        texts: [
          'Вижу — стволы есть. Уже лучше, чем было. Дальше проще: доски, верстак, и ты уже не страница без адреса.',
          'Смотри. Страница без адреса — просто бумага. Но адрес, который никто не помнит, — тоже просто бумага. Поэтому Указатель и живёт: его нужно читать.',
        ],
        buttons: [
          {
            label: 'greet',
            name: 'Дальше.',
            actions: [
              { type: 'OPEN_NAMED_DIALOG', cmd: 'greet' },
            ],
          },
        ],
      },
    ],
    rules: [
      { quest: 'start:wood', dialog: 'after_wood', condition: 'COMPLETED', priority: 20 },
      { quest: 'start:wood', dialog: 'greet', condition: 'NOT_COMPLETED', priority: 5 },
    ],
  },
  {
    id: 'miya',
    name: 'Мия Тинь',
    skin: 'PROFESSOR_01',
    color: '#9BC9E8',
    lines: [
      {
        label: 'greet',
        name: 'Мия',
        priority: 5,
        texts: [
          'Записала! Значит, это было. Нельзя сказать, что этого не было, если это записано.',
          'Я — Мия. Инвентаризатор. Ну, теперь инвентаризатор обломков. Папа тоже был инвентаризатором, только до Нырка.',
          'Я записываю всё, что вижу. Например: облако над болотом было в форме библиотеки. А сегодня оно было в форме облака. Это тоже важно.',
        ],
        buttons: [
          {
            label: 'mother',
            name: 'Ты ищешь маму?',
            actions: [
              { type: 'OPEN_NAMED_DIALOG', cmd: 'mother' },
            ],
          },
          {
            label: 'hint',
            name: 'Где что лежит?',
            actions: [
              { type: 'OPEN_NAMED_DIALOG', cmd: 'hint' },
            ],
          },
          {
            label: 'bye',
            name: 'Пока!',
            actions: [],
          },
        ],
      },
      {
        label: 'mother',
        name: 'Ирма',
        priority: 5,
        texts: [
          'Ирма Тинь. Да. Она ушла вниз во время Нырка — на раздачу копий, как все Хранители. Так говорят.',
          'Я ищу. У меня есть журнал: в нём записано, что она брала с собой ящик с нерассортированным. Значит, где-то есть ящик. Значит, есть след.',
          'Если найдём её записи — узнаем и про неё, и про Якорь. Не торопи. Я ищу шесть лет, ещё потерплю.',
        ],
        buttons: [
          {
            label: 'greet',
            name: 'Назад.',
            actions: [
              { type: 'OPEN_NAMED_DIALOG', cmd: 'greet' },
            ],
          },
        ],
      },
      {
        label: 'hint',
        name: 'Где искать',
        priority: 5,
        texts: [
          'Смотри по земле, а не по небу. Там, где пепел лёг кольцом, — был корпус. А в корпусах — полки. А на полках — всё, что мы ищем.',
          'Ещё: если найдёшь белый лист — не выбрасывай. Это не пустая страница. Это кто-то, кто стёрся.',
        ],
        buttons: [
          {
            label: 'greet',
            name: 'Спасибо!',
            actions: [
              { type: 'OPEN_NAMED_DIALOG', cmd: 'greet' },
            ],
          },
        ],
      },
      {
        label: 'after_journal',
        name: 'Ты записал',
        priority: 20,
        texts: [
          'Видишь? Записал — значит, было. Теперь это не просто «где-то». У этого есть номер, полка и подпись.',
          'Именно так Архив и держался. Не на бумаге. На том, что кто-то записал.',
        ],
        buttons: [
          {
            label: 'greet',
            name: 'Пойду дальше.',
            actions: [
              { type: 'OPEN_NAMED_DIALOG', cmd: 'greet' },
            ],
          },
        ],
      },
    ],
    rules: [
      { quest: 'start:journal', dialog: 'after_journal', condition: 'COMPLETED', priority: 20 },
      { quest: 'start:journal', dialog: 'greet', condition: 'NOT_COMPLETED', priority: 5 },
    ],
  },
];
