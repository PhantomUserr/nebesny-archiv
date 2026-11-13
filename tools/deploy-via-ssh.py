"""
Небесный Архив — автоматический деплой на удалённый Linux-сервер по SSH.

Использование:
    python tools/deploy-via-ssh.py <user@host> [--key <path>] [--sudo-pass <пароль>]

Что делает:
  1. копирует на сервер комплект server/ и скрипты tools/
  2. запускает deploy-remote.sh  (Java 21, NeoForge, пак модов, eula, properties, JVM)
  3. ставит systemd-юнит и правила ufw
  4. стартует сервис и ждёт "Done (" в логе
  5. печатает адрес для подключения клиентов
"""
import argparse
import os
import posixpath
import sys
import time

import paramiko

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def run(ssh, cmd, timeout=1800, sudo_pass=None, check=True, quiet=False):
    """Выполняет команду, при необходимости через sudo."""
    if cmd.startswith("sudo "):
        inner = cmd[5:]
        cmd = f"sudo -S -p '' bash -c {shell_quote(inner)}"
        stdin, stdout, stderr = ssh.exec_command(cmd, get_pty=True, timeout=timeout)
        if sudo_pass is not None:
            stdin.write(sudo_pass + "\n")
        stdin.flush()
    else:
        stdin, stdout, stderr = ssh.exec_command(cmd, get_pty=True, timeout=timeout)
    out = stdout.read().decode("utf-8", "replace")
    err = stderr.read().decode("utf-8", "replace")
    code = stdout.channel.recv_exit_status()
    if not quiet:
        print(out, end="")
        if err.strip():
            print(err, end="", file=sys.stderr)
    if check and code != 0:
        raise RuntimeError(f"команда упала ({code}): {cmd}\n{out}\n{err}")
    return code, out, err


def shell_quote(s):
    return "'" + s.replace("'", "'\\''") + "'"


def upload(sftp, local, remote):
    sftp.put(local, remote)
    print(f"  + {os.path.basename(local)}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("target", help="user@host")
    ap.add_argument("--key", default=os.path.expanduser("~/.ssh/nebesny_ed25519"))
    ap.add_argument("--sudo-pass", default=None)
    ap.add_argument("--dir", default="~/nebesny-archiv")
    ap.add_argument("--skip-service", action="store_true")
    args = ap.parse_args()

    user, host = args.target.split("@", 1)

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    print(f"==> подключаюсь к {user}@{host}")
    ssh.connect(host, username=user, key_filename=args.key,
                allow_agent=False, look_for_keys=False, timeout=20)
    sftp = ssh.open_sftp()
    print("==> подключён")

    print("==> инвентаризация машины")
    run(ssh, "uname -a; echo ---; cat /etc/os-release | head -3; echo ---; "
             "nproc; free -m | head -2; echo ---; df -h $HOME | tail -1; echo ---; "
             "java -version 2>&1 | head -1 || true; echo ---; "
             "ldd --version | head -1; echo ---; sudo -n true 2>&1 && echo 'sudo: без пароля' || echo 'sudo: нужен пароль'")

    remote = os.path.expanduser(args.dir)
    print(f"==> каталог {remote}")
    run(ssh, f"mkdir -p {shell_quote(remote)}")

    print("==> копирую комплект сервера")
    for name in ["packwiz-installer-bootstrap.jar", "start-server.sh",
                 "user_jvm_args.txt", "pack-url.txt", "server.properties.example"]:
        src = os.path.join(ROOT, "server", name)
        if os.path.exists(src):
            upload(sftp, src, posixpath.join(remote, name))

    print("==> копирую скрипт деплоя")
    upload(sftp, os.path.join(ROOT, "tools", "deploy-remote.sh"),
           posixpath.join(remote, "deploy-remote.sh"))
    if not args.skip_service:
        upload(sftp, os.path.join(ROOT, "tools", "install-service.sh"),
               posixpath.join(remote, "install-service.sh"))
    sftp.close()

    print("==> запускаю deploy-remote.sh (долго: качает ~2 ГБ модов)")
    run(ssh, f"cd {shell_quote(remote)} && bash deploy-remote.sh {shell_quote(remote)}",
        timeout=3600)

    if not args.skip_service:
        print("==> ставлю systemd-юнит")
        run(ssh, f"cd {shell_quote(remote)} && sudo bash install-service.sh {shell_quote(remote)}",
            sudo_pass=args.sudo_pass)

    print("==> запускаю сервис")
    run(ssh, "sudo systemctl restart nebesny-archiv", sudo_pass=args.sudo_pass, check=False)

    print("==> жду загрузки сервера")
    ok = False
    for i in range(60):
        time.sleep(10)
        _, out, _ = run(ssh, "sudo journalctl -u nebesny-archiv --no-pager -n 40 | tail -20",
                        sudo_pass=args.sudo_pass, check=False, quiet=True)
        if "Done (" in out:
            ok = True
            print(f"    сервер поднялся за ~{(i+1)*10} с")
            break
        print(".", end="", flush=True)
    print()

    print("==> состояние")
    run(ssh, "sudo systemctl status nebesny-archiv --no-pager -n 5",
        sudo_pass=args.sudo_pass, check=False)
    run(ssh, "grep -E '^(server-port|online-mode|max-players|view-distance)' "
             f"{shell_quote(remote)}/server.properties || true")

    print("\nГотово. Адрес для клиентов: " + host + ":25565")
    ssh.close()


if __name__ == "__main__":
    main()
