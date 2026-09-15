param([Parameter(Mandatory=$true)][int]$AppProcessId,[ValidateSet('select','cancel','apostrophe')][string]$Action='select',[string]$FilePath)
# Only address windows belonging to this test's isolated native process.
Add-Type @'
using System;
using System.Text;
using System.Threading;
using System.Runtime.InteropServices;
public static class NativeFilePickerTest {
 public delegate bool Callback(IntPtr window,IntPtr state);
 [DllImport("user32.dll")] static extern bool EnumWindows(Callback callback,IntPtr state);
 [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr parent,Callback callback,IntPtr state);
 [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window,out uint pid);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr window,StringBuilder name,int count);
 [DllImport("user32.dll")] static extern int GetDlgCtrlID(IntPtr window);
 [DllImport("user32.dll")] static extern IntPtr GetParent(IntPtr window);
 [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern IntPtr SendMessage(IntPtr window,uint message,IntPtr w,string text);
 [DllImport("user32.dll")] static extern bool PostMessage(IntPtr window,uint message,IntPtr w,IntPtr l);
 [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr window,IntPtr after,int x,int y,int w,int h,uint flags);
 static string Class(IntPtr window){var name=new StringBuilder(256);GetClassName(window,name,256);return name.ToString();}
 public static void Run(uint process,string action,string file){
  if(action=="apostrophe"){
   EnumWindows((window,state)=>{uint pid;GetWindowThreadProcessId(window,out pid);if(pid==process&&Class(window)=="UnrealWindow"){
    PostMessage(window,0x100,new IntPtr(0xDE),new IntPtr(1));Thread.Sleep(80);PostMessage(window,0x101,new IntPtr(0xDE),new IntPtr(0xC0000001));
   }return true;},IntPtr.Zero);Console.WriteLine("Sent apostrophe to isolated app");return;
  }
  IntPtr dialog=IntPtr.Zero;
  for(int attempt=0;attempt<150&&dialog==IntPtr.Zero;attempt++){
   EnumWindows((window,state)=>{uint pid;GetWindowThreadProcessId(window,out pid);if(pid==process&&Class(window)=="#32770"&&IsWindowVisible(window))dialog=window;return true;},IntPtr.Zero);
   if(dialog==IntPtr.Zero)Thread.Sleep(100);
  }
  if(dialog==IntPtr.Zero)throw new Exception("The real native file dialog did not appear");
  SetWindowPos(dialog,IntPtr.Zero,-20000,-20000,0,0,0x15);
  if(action=="cancel"){PostMessage(dialog,0x111,new IntPtr(2),IntPtr.Zero);Console.WriteLine("Native dialog cancelled");return;}
  IntPtr edit=IntPtr.Zero;
  EnumChildWindows(dialog,(window,state)=>{if(Class(window)=="Edit"&&(GetDlgCtrlID(window)==1148||GetDlgCtrlID(GetParent(window))==1148))edit=window;return true;},IntPtr.Zero);
  if(edit==IntPtr.Zero)throw new Exception("Native filename control was not found");
  SendMessage(edit,0xC,IntPtr.Zero,file);PostMessage(dialog,0x111,new IntPtr(1),IntPtr.Zero);
  Console.WriteLine("Selected file through native dialog");
 }
}
'@
if($Action -eq 'select' -and !(Test-Path -LiteralPath $FilePath -PathType Leaf)){throw 'Fixture does not exist'}
[NativeFilePickerTest]::Run($AppProcessId,$Action,$FilePath)
