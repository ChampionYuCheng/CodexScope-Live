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
  MsgBox "启动文件不完整，请重新下载或解压 CodexScope-Live。", vbCritical, "CodexScope-Live"
  WScript.Quit 1
End If

cargoStatus = shell.Run("cmd.exe /d /c where cargo >nul 2>nul", 0, True)
If cargoStatus <> 0 And Not files.FileExists(cachedExe) Then
  MsgBox "当前是源码目录，但没有检测到 Rust/Cargo，也没有可用的缓存程序。" & vbCrLf & vbCrLf & _
         "普通用户请从 GitHub Releases 下载 Windows x64 免安装 ZIP。", vbInformation, "CodexScope-Live"
  WScript.Quit 1
End If

command = Chr(34) & sourceLauncher & Chr(34)
shell.Run command, 0, False
