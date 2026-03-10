; Enigma Relay - Inno Setup Script
; Requires Inno Setup 6+ (https://jrsoftware.org/isinfo.php)

[Setup]
AppName=Enigma Relay
AppVersion=2.0.0
AppPublisher=Enigma
DefaultDirName={autopf}\Enigma Relay
DefaultGroupName=Enigma Relay
UninstallDisplayIcon={app}\relay\src\server.js
OutputDir=output
OutputBaseFilename=EnigmaRelaySetup
Compression=lzma2
SolidCompression=yes
PrivilegesRequired=lowest
SetupIconFile=enigma.ico
DisableProgramGroupPage=yes

[Files]
; Node.js portable
Source: "build\node\*"; DestDir: "{app}\node"; Flags: ignoreversion recursesubdirs

; Relay application
Source: "build\relay\*"; DestDir: "{app}\relay"; Flags: ignoreversion recursesubdirs

; Launchers
Source: "build\Enigma Relay.vbs"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
; Start menu shortcut
Name: "{group}\Enigma Relay"; Filename: "{app}\Enigma Relay.vbs"; WorkingDir: "{app}"

; Desktop shortcut
Name: "{autodesktop}\Enigma Relay"; Filename: "{app}\Enigma Relay.vbs"; WorkingDir: "{app}"

; Startup entry (optional)
Name: "{userstartup}\Enigma Relay"; Filename: "{app}\Enigma Relay.vbs"; WorkingDir: "{app}"

[Registry]
; Register .enigma file association
Root: HKCU; Subkey: "Software\Classes\.enigma"; ValueType: string; ValueData: "EnigmaFile"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\EnigmaFile"; ValueType: string; ValueData: "Enigma Encrypted Message"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\EnigmaFile\shell\open\command"; ValueType: string; ValueData: """{app}\node\node.exe"" ""{app}\relay\src\server.js"" ""%1"""; Flags: uninsdeletekey

[Run]
; Launch after install
Filename: "{app}\Enigma Relay.vbs"; Description: "Start Enigma Relay"; Flags: postinstall nowait shellexec
