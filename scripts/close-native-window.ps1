param([Parameter(Mandatory=$true)][int]$AppProcessId)
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class NativeSmokeWindow {
  public delegate bool Callback(IntPtr window, IntPtr state);
  [DllImport("user32.dll")] public static extern bool EnumWindows(Callback callback, IntPtr state);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr window, uint message, IntPtr w, IntPtr l);
  public static void Close(uint process) {
    EnumWindows((window, state) => { uint pid; GetWindowThreadProcessId(window, out pid);
      if (pid == process) PostMessage(window, 0x10, IntPtr.Zero, IntPtr.Zero);
      return true;
    }, IntPtr.Zero);
  }
}
'@
[NativeSmokeWindow]::Close($AppProcessId)
