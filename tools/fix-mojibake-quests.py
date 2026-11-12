import io
import re

PATH = r"C:\Users\qwert\Desktop\GDZ\nebo-archiv\tools\quest-data.mjs"

# Each entry: quest key -> (title, [line1, line2])
# Text taken from docs/quest-rewrites.md (the agreed rewrites) and the
# story bible, so the wording matches what was planned.
FIXES = {
    "wood": (
        "Первое дерево",
        [
            "Подойди к дереву и просто кликни по нему — блок дерева разрушится, и ты мгновенно получишь брёвна в инвентаре.",
            "Сними 8 брёвен: на них хватит досок, палок, верстака и первой кирки. Из брёвен получится всё остальное: доски, палки, верстак и первые инструменты.",
        ],
    ),
    "stone_tools": (
        "Каменные инструменты",
        [
            "Каменная кирка быстрее деревянной и нужна, чтобы добывать железную руду. Сделай кирку и каменный меч — меч пригодится при встрече с монстрами.",
            "Когда кирка будет готова, переходи дальше: жжёная древесина даст топливо для печи.",
        ],
    ),
    "cutting": (
        "Разделочная доска",
        [
            "На доске можно нарезать овощи и готовить блюда для кастрюли. Сделай разделочную доску — палки и доски у тебя уже есть после квестов на дерево.",
            "Нож для разделки можно сделать позже, когда появится кожа или другой материал для ручки.",
        ],
    ),
    "door": (
        "Вход в дом",
        [
            "Двери защищают от мобов и не пропускают дождь.",
            "Поставь две двери: одна станет главным входом, вторая — для гостевой, чердака или заднего двора.",
        ],
    ),
    "shaft": (
        "Валы",
        [
            "Вал передаёт вращение. Поставь его между колесом и механизмом.",
            "Валы можно соединять, поворачивать и закрывать корпусами.",
        ],
    ),
    "fly": (
        "Первый полёт",
        [
            "Собери корабль до конца: крылья, двигатель, пульт и балласт. Хороший маленький корабль, который летает, лучше огромного, который падает.",
            "Поднимись в воздух и пролети хотя бы 100 блоков от старта. Управляй плавно — резкие повороты переворачивают корабль. Если корабль падает, проверь баланс, тягу и клей.",
        ],
    ),
    "claim": (
        "Застолбить небо",
        [
            "Блок заявки защищает твой корабль от чужих рук.",
            "Поставь его на борт корабля — после этого другие игроки не смогут ломать твой корабль без твоего разрешения.",
        ],
    ),
    "wand": (
        "Жезл",
        [
            "Жезл — инструмент для создания заклинаний и ритуалов в Ars Nouveau.",
            "Сделай его вместе с книгой новичка: на жезле можно наносить глифы, из которых собираются заклинания.",
        ],
    ),
    "malum_bench": (
        "Рунный верстак",
        [
            "Malum — мрачная магия душ, и рунный верстак — её первый шаг.",
            "Поставь верстак рядом с домом или в мастерской и открой его, чтобы посмотреть рецепты первых рун.",
        ],
    ),
    "archmage": (
        "Архимаг",
        [
            "Магия Архива пошла в гору: от книги новичка до архимагской. Книга архимага — это уже не просто свиток, а подлинное могущество.",
            "Собери её и проверь силу новых заклинаний в безопасном месте.",
        ],
    ),
    "cartography": (
        "Последний маршрут",
        [
            "Все руины, порталы и сокровища ты уже видел — самое время записать путь. Карта поможет не потерять маршрут и вернуться к важным местам.",
            "Скрафти пустую карту и используй её, чтобы начать наносить местность.",
        ],
    ),
}


def quote(text):
    return "'" + text.replace("\\", "\\\\").replace("'", "\\'") + "'"


def fix_block(lines, key):
    """Replace the title and description of the Q('key', ...) block."""
    title, desc = FIXES[key]

    # Locate the Q('key', ...) line.
    start = None
    for i, line in enumerate(lines):
        if re.match(r"\s*Q\('%s',\s*" % re.escape(key), line):
            start = i
            break
    if start is None:
        raise SystemExit(f"quest '{key}' not found")

    # The title may be corrupted (question marks) or already correct.
    lines[start] = re.sub(
        r"(Q\('%s',\s*)('[^']*'|\"[^\"]*\")" % re.escape(key),
        lambda m: m.group(1) + quote(title),
        lines[start],
    )

    # The description is the array literal that follows the title line.
    desc_start = None
    for i in range(start + 1, min(start + 8, len(lines))):
        if lines[i].lstrip().startswith("["):
            desc_start = i
            break
    if desc_start is None:
        raise SystemExit(f"description array of '{key}' not found")

    # Collect the description lines: from "[" up to the line ending with "],".
    desc_end = None
    for i in range(desc_start, min(desc_start + 10, len(lines))):
        if lines[i].rstrip().endswith("],"):
            desc_end = i
            break
    if desc_end is None:
        raise SystemExit(f"end of description of '{key}' not found")

    indent = " " * (len(lines[desc_start]) - len(lines[desc_start].lstrip()))
    body = [f"{indent}['{desc[0]}',"]
    body.append(f"{indent} '{desc[1]}'],")
    lines[desc_start : desc_end + 1] = body
    return lines


s = io.open(PATH, "r", encoding="utf-8").read()
lines = s.split("\n")

for key in FIXES:
    lines = fix_block(lines, key)

io.open(PATH, "w", encoding="utf-8", newline="\n").write("\n".join(lines))
print(f"repaired {len(FIXES)} quest blocks")
