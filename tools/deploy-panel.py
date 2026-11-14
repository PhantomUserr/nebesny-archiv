#!/usr/bin/env python3
"""Deploy MCPanel (multi-server Minecraft panel) to a remote Linux host over SSH.

Usage:
    python tools/deploy-panel.py [user@host] [--key PATH] [--sudo-pass PASS]
                                 [--password PANEL_PASSWORD]

Copies panel/ (including data/ when present), runs install.sh with sudo,
verifies the HTTP API, and refreshes desktop shortcuts.
"""
import argparse
import os
import posixpath
import socket
import sys
import time

import paramiko

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PANEL_SRC = os.path.join(ROOT, "panel")

TEXT_EXT = (".sh", ".js", ".json", ".css", ".html", ".service", ".md", ".txt")
SKIP_FILES = {".password", ".secret", ".env"}
SKIP_DIRS = {"node_modules", ".git", "__pycache__"}

DESKTOP_FILES = {
    "MCPanel — панель.desktop": """[Desktop Entry]
Type=Application
Version=1.0
Name=MCPanel — панель
Comment=Веб-панель управления серверами Minecraft
Exec=xdg-open http://127.0.0.1:8080
Icon=applications-internet
Terminal=false
Categories=Utility;Game;
""",
    "MCPanel — управление сервером.desktop": """[Desktop Entry]
Type=Application
Version=1.0
Name=MCPanel — управление сервером
Comment=Открыть панель и управлять серверами Minecraft
Exec=xdg-open http://127.0.0.1:8080
Icon=applications-system
Terminal=false
Categories=Utility;Game;
""",
}

VERIFY_SCRIPT = r"""
import http.cookiejar
import json
import sys
import urllib.error
import urllib.request

BASE = "http://127.0.0.1:8080"
PASSWORD = sys.argv[1]

jar = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))


def call(path, data=None, method=None):
    body = None
    headers = {}
    if data is not None:
        body = json.dumps(data).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(BASE + path, data=body, headers=headers, method=method)
    try:
        with opener.open(req, timeout=20) as resp:
            return resp.status, resp.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode("utf-8", "replace")
    except Exception as exc:  # noqa: BLE001
        return 0, str(exc)


failed = False

code, _ = call("/")
print(f"GET /              -> {code}")
if code != 200:
    failed = True

code, text = call("/api/login", {"password": PASSWORD})
print(f"POST /api/login    -> {code}")
if code != 200:
    print("    (пароль панели мог быть изменён — авторизованные проверки пропущены)")
    sys.exit(2)

code, text = call("/api/overview")
ok = code == 200
try:
    data = json.loads(text)
    summary = f"host={data.get('host', {}).get('hostname')} servers={len(data.get('servers', []))}"
except Exception:  # noqa: BLE001
    summary = text[:160].replace("\n", " ")
print(f"GET /api/overview  -> {code} {summary}")
failed = failed or not ok

code, text = call("/api/servers")
sid = ""
ok = code == 200
try:
    data = json.loads(text)
    servers = data.get("servers") or []
    sid = servers[0].get("id") if servers else ""
    names = ", ".join(s.get("name", "?") for s in servers) or "—"
    summary = f"{len(servers)}: {names}"
except Exception:  # noqa: BLE001
    summary = text[:160].replace("\n", " ")
print(f"GET /api/servers   -> {code} {summary}")
failed = failed or not ok

if sid:
    import urllib.parse

    qsid = urllib.parse.quote(sid, safe="")
    code, text = call(f"/api/servers/{qsid}/status")
    ok = code == 200
    try:
        data = json.loads(text)
        summary = f"active={data.get('active')} port={data.get('port')} mods={data.get('mods')}"
    except Exception:  # noqa: BLE001
        summary = text[:160].replace("\n", " ")
    print(f"GET status {sid} -> {code} {summary}")
    failed = failed or not ok

    code, text = call(f"/api/servers/{qsid}/files?path=")
    ok = code == 200
    try:
        data = json.loads(text)
        summary = f"entries={len(data.get('entries', []))}"
    except Exception:  # noqa: BLE001
        summary = text[:160].replace("\n", " ")
    print(f"GET files {sid}  -> {code} {summary}")
    failed = failed or not ok

sys.exit(1 if failed else 0)
"""


def shell_quote(s: str) -> str:
    return "'" + s.replace("'", "'\\''") + "'"


class Remote:
    def __init__(self, host, user, key, sudo_pass):
        self.host = host
        self.user = user
        self.sudo_pass = sudo_pass
        self.ssh = paramiko.SSHClient()
        self.ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        self.ssh.connect(
            host,
            username=user,
            key_filename=key,
            timeout=20,
            allow_agent=False,
            look_for_keys=False,
        )
        self.sftp = self.ssh.open_sftp()

    def run(self, cmd, timeout=600, sudo=False, quiet=False):
        full = ("sudo -S -p '' bash -c " + shell_quote(cmd)) if sudo else cmd
        stdin, stdout, stderr = self.ssh.exec_command(full, timeout=timeout)
        if sudo and self.sudo_pass is not None:
            stdin.write(self.sudo_pass + "\n")
            stdin.flush()
        out = stdout.read().decode("utf-8", "replace")
        err = stderr.read().decode("utf-8", "replace")
        code = stdout.channel.recv_exit_status()
        if not quiet:
            if out.strip():
                print(out.rstrip())
            if err.strip():
                print("stderr:", err.strip()[:1200])
        return code, out, err

    def close(self):
        try:
            self.sftp.close()
        except Exception:
            pass
        self.ssh.close()


def upload_file(remote: Remote, local: str, remote_path: str):
    with open(local, "rb") as f:
        data = f.read()
    if local.lower().endswith(TEXT_EXT):
        data = data.replace(b"\r\n", b"\n")
    with remote.sftp.file(remote_path, "wb") as f:
        f.write(data)


def upload_tree(remote: Remote, local_dir: str, remote_dir: str):
    remote.run(f"mkdir -p {shell_quote(remote_dir)}", quiet=True)
    for name in sorted(os.listdir(local_dir)):
        if name in SKIP_FILES:
            print(f"  - пропуск {name}")
            continue
        local_path = os.path.join(local_dir, name)
        remote_path = posixpath.join(remote_dir, name)
        if os.path.isdir(local_path):
            if name in SKIP_DIRS:
                print(f"  - пропуск {name}/")
                continue
            upload_tree(remote, local_path, remote_path)
            continue
        upload_file(remote, local_path, remote_path)
        print("  +", posixpath.join(posixpath.basename(remote_dir), name))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("target", nargs="?", default="server@192.168.10.216")
    ap.add_argument("--key", default=os.path.expanduser("~/.ssh/nebesny_ed25519"))
    ap.add_argument("--sudo-pass", default="    ")
    ap.add_argument("--remote-dir", default="/home/server/panel")
    ap.add_argument("--password", default="nebesny2026")
    args = ap.parse_args()

    if "@" not in args.target:
        print("!!! укажите цель в формате user@host")
        sys.exit(2)
    user, host = args.target.split("@", 1)

    try:
        s = socket.create_connection((host, 22), timeout=8)
        s.close()
    except OSError as e:
        print(f"!!! {host}:22 недоступен ({e}). Машина выключена или спит?")
        sys.exit(2)

    print(f"==> подключаюсь к {user}@{host}")
    remote = Remote(host, user, args.key, args.sudo_pass)

    print("==> заливаю файлы панели")
    upload_tree(remote, PANEL_SRC, args.remote_dir)

    print("\n==> запускаю установку (node/npm могут скачиваться)")
    code, out, err = remote.run(
        f"cd {shell_quote(args.remote_dir)} && bash install.sh",
        timeout=1800,
        sudo=True,
    )
    if code != 0:
        print("!!! установка упала")
        remote.close()
        sys.exit(3)

    print("\n==> служба панели")
    remote.run("systemctl is-enabled mcpanel; systemctl is-active mcpanel", quiet=False)

    print("\n==> проверка API")
    code, out, err = remote.run(
        f"python3 - {shell_quote(args.password)} <<'PY'\n{VERIFY_SCRIPT}\nPY",
        timeout=180,
    )
    if code == 2:
        print("!!! вход не удался: пароль панели изменён. API-проверки пропущены.")
    elif code != 0:
        print("!!! проверка API нашла проблемы (см. выше)")

    print("\n==> ярлыки на рабочем столе")
    _, desktop_out, _ = remote.run(
        "D=''; "
        "if command -v xdg-user-dir >/dev/null 2>&1; then D=$(xdg-user-dir DESKTOP 2>/dev/null || true); fi; "
        "if [ -z \"$D\" ] || [ \"$D\" = \"$HOME\" ]; then "
        "  if [ -d \"$HOME/Рабочий стол\" ]; then D=\"$HOME/Рабочий стол\"; else D=\"$HOME/Desktop\"; fi; "
        "fi; "
        "mkdir -p \"$D\"; "
        "for old in \"$HOME/Desktop\" \"$HOME/Рабочий стол\"; do "
        "  if [ -d \"$old\" ]; then find \"$old\" -maxdepth 1 -type f -name '*Небесный*' -delete 2>/dev/null || true; fi; "
        "done; "
        "printf '%s\\n' \"$D\"",
        timeout=60,
        quiet=True,
    )
    desktop = desktop_out.strip().splitlines()[-1] if desktop_out.strip() else f"/home/{user}/Desktop"
    print(f"    каталог: {desktop}")

    for name, content in DESKTOP_FILES.items():
        target = posixpath.join(desktop, name)
        try:
            with remote.sftp.file(target, "wb") as f:
                f.write(content.encode("utf-8"))
            remote.run(f"chmod +x {shell_quote(target)}", quiet=True)
            print("  +", name)
        except Exception as e:  # noqa: BLE001
            print(f"  ! не удалось создать {name}: {e}")

    remote.run("systemctl is-enabled mcpanel; systemctl is-active mcpanel", quiet=True)

    print(f"\nГотово: http://{host}:8080  (служба mcpanel, пароль по умолчанию: {args.password})")
    remote.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
