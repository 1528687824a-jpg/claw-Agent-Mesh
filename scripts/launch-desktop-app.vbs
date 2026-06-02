Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
ps1 = fso.BuildPath(scriptDir, "launch-desktop-app.ps1")
logPath = fso.BuildPath(fso.GetParentFolderName(scriptDir), "logs\desktop-launcher.log")
cmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & ps1 & """"
exitCode = CreateObject("WScript.Shell").Run(cmd, 0, True)
If exitCode <> 0 Then
  MsgBox "Agent OpenClaw failed to start." & vbCrLf & vbCrLf & _
    "See startup details here:" & vbCrLf & logPath, _
    vbExclamation, "Agent OpenClaw"
End If
