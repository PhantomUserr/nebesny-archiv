# Gracefully stops a Minecraft server running in a Windows console.
#
# The server's JVM reads console input from CONIN$ when it is attached to a
# console. Injecting a Ctrl+C event makes the JVM run its shutdown hooks, which
# is exactly what pressing Ctrl+C in the server window does: Minecraft saves the
# world and exits cleanly.
#
# The helper ignores Ctrl+C for itself so the server is the only process that
# reacts to it.
param(
  [Parameter(Mandatory = $true)][int]$ServerPid
)

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class ConsoleCtrl {
  [DllImport("kernel32.dll", SetLastError = true)] public static extern bool FreeConsole();
  [DllImport("kernel32.dll", SetLastError = true)] public static extern bool AttachConsole(uint pid);
  [DllImport("kernel32.dll", SetLastError = true)] public static extern bool GenerateConsoleCtrlEvent(uint evt, uint group);
  [DllImport("kernel32.dll", SetLastError = true)] public static extern bool SetConsoleCtrlHandler(IntPtr handler, bool add);

  public static string Stop(uint pid) {
    // Ignore Ctrl+C in this helper process.
    SetConsoleCtrlHandler(IntPtr.Zero, true);
    FreeConsole();
    if (!AttachConsole(pid)) return "attach failed err=" + Marshal.GetLastWin32Error();
    bool ok = GenerateConsoleCtrlEvent(0, 0);
    int err = Marshal.GetLastWin32Error();
    FreeConsole();
    return "ctrlc=" + ok + " err=" + err;
  }
}
"@

Write-Output ([ConsoleCtrl]::Stop([uint32]$ServerPid))
