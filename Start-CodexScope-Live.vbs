Option Explicit

Dim shell, files, root, packagedExe, sourceLauncher, cachedExe, cargoStatus, command
Set shell = CreateObject("WScript.Shell")
Set files = CreateObject("Scripting.FileSystemObject")
root = files.GetParentFolderName(WScript.ScriptFullName)
packagedExe = files.BuildPath(root, "CodexScope-Live.exe")
sourceLauncher = files.BuildPath(root, "windows\open-dashboard.cmd")
cachedExe = files.BuildPath(root, "live-server\target\release\codexscope-live.exe")

If files.FileExists(packagedExe) Then
  command = Chr(34) & packagedExe & Chr(34)
  shell.Run command, 0, False
  WScript.Quit 0
End If

If Not files.FileExists(sourceLauncher) Then
  MsgBox "Required launcher files are missing. Download or extract CodexScope-Live again.", vbCritical, "CodexScope-Live"
  WScript.Quit 1
End If

cargoStatus = shell.Run("cmd.exe /d /c where cargo >nul 2>nul", 0, True)
If cargoStatus <> 0 And Not files.FileExists(cachedExe) Then
  MsgBox "This is a source checkout, but Rust/Cargo and a cached server executable were not found." & vbCrLf & vbCrLf & _
         "Download the Windows x64 portable ZIP from GitHub Releases.", vbInformation, "CodexScope-Live"
  WScript.Quit 1
End If

command = Chr(34) & sourceLauncher & Chr(34)
shell.Run command, 0, False
