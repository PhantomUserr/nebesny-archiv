# Sends a command line to a running Minecraft server console on Windows.
# The server process keeps its own console; we attach to it and inject key events
# into CONIN$ so the "Server console handler" thread reads them like typed input.
#
# Usage: powershell -File send-console.ps1 -Pid <server pid> -Text "stop"
param(
  [Parameter(Mandatory = $true)][int]$Pid_,
  [Parameter(Mandatory = $true)][string]$Text,
  [int]$WaitSeconds = 0
)

Add-Type @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public class ConWriter {
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool FreeConsole();
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool AttachConsole(uint pid);
  [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
  public static extern IntPtr CreateFileW(string name, uint access, uint share, IntPtr attrs, uint disp, uint flags, IntPtr templ);
  [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
  public static extern bool WriteConsoleInputW(IntPtr h, INPUT_RECORD[] rec, uint len, out uint written);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool CloseHandle(IntPtr h);

  [StructLayout(LayoutKind.Explicit)] public struct INPUT_RECORD {
    [FieldOffset(0)] public ushort EventType;
    [FieldOffset(4)] public KEY_EVENT_RECORD KeyEvent;
  }
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public struct KEY_EVENT_RECORD {
    public int bKeyDown;
    public ushort wRepeatCount;
    public ushort wVirtualKeyCode;
    public ushort wVirtualScanCode;
    public char UnicodeChar;
    public uint dwControlKeyState;
  }

  static ushort Scan(char c) {
    switch (char.ToLowerInvariant(c)) {
      case 's': return 0x1F; case 't': return 0x14; case 'o': return 0x18; case 'p': return 0x19;
      case 'r': return 0x13; case 'e': return 0x12; case 'a': return 0x1E; case 'i': return 0x17;
      case 'n': return 0x31; case 'd': return 0x20; case 'c': return 0x2E; case 'u': return 0x16;
      case 'v': return 0x2F; case 'h': return 0x33; case 'l': return 0x26; case 'k': return 0x25;
      case 'm': return 0x32; case 'w': return 0x11; case 'b': return 0x30; case 'g': return 0x22;
      case 'y': return 0x15; case 'f': return 0x21; case 'x': return 0x2D; case 'z': return 0x2C;
      case 'q': return 0x10; case 'j': return 0x24;
      case '\r': case '\n': return 0x1C;
      case ' ': return 0x39; case '-': return 0x0C; case '_': return 0x38; case ':': return 0x27;
      case '.': return 0x34; case ',': return 0x33; case '/': return 0x35; case '\\': return 0x2B;
      case '=': return 0x0D; case ';': return 0x27; case '\'': return 0x28; case '[': return 0x1A;
      case ']': return 0x1B; case '?': return 0x35; case '!': return 0x1E; case '@': return 0x19;
      case '+': return 0x0E; case '*': return 0x37; case '#': return 0x0B; case '%': return 0x37;
      default: return 0;
    }
  }

  public static string Send(uint pid, string text) {
    FreeConsole();
    if (!AttachConsole(pid)) return "attach failed err=" + Marshal.GetLastWin32Error();
    IntPtr h = CreateFileW("CONIN$", 0xC0000000, 3, IntPtr.Zero, 3, 0, IntPtr.Zero);
    if (h == IntPtr.Zero || h == (IntPtr)(-1)) return "conin failed err=" + Marshal.GetLastWin32Error();
    var list = new List<INPUT_RECORD>();
    foreach (char c in text) {
      ushort vk = (c == '\r' || c == '\n') ? (ushort)0x0D : (ushort)char.ToUpperInvariant(c);
      INPUT_RECORD d = new INPUT_RECORD();
      d.EventType = 1;
      d.KeyEvent.bKeyDown = 1;
      d.KeyEvent.wRepeatCount = 1;
      d.KeyEvent.wVirtualKeyCode = vk;
      d.KeyEvent.wVirtualScanCode = Scan(c);
      d.KeyEvent.UnicodeChar = (c == '\n' ? '\r' : c);
      d.KeyEvent.dwControlKeyState = 0;
      INPUT_RECORD u = d;
      u.KeyEvent.bKeyDown = 0;
      list.Add(d); list.Add(u);
    }
    uint written;
    bool ok = WriteConsoleInputW(h, list.ToArray(), (uint)list.Count, out written);
    CloseHandle(h);
    FreeConsole();
    return "write=" + ok + " written=" + written;
  }
}
"@

$result = [ConWriter]::Send([uint32]$Pid_, $Text + "`r")
if ($WaitSeconds -gt 0) { Start-Sleep -Seconds $WaitSeconds }
Write-Output $result
