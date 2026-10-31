; Inno Setup installer for Crypto Conex PC (APP DE SUPORTE TÉCNICO)
#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif

[Setup]
AppId={{8C1E4B2A-7D3F-4E8B-9A61-CC0A5E7F1B21}
AppName=APP DE SUPORTE TÉCNICO
AppVersion={#AppVersion}
AppPublisher=Crypto Conex
DefaultDirName={autopf}\CryptoConex
DefaultGroupName=Suporte Técnico
OutputBaseFilename=CryptoConexSetup
OutputDir=..\dist
SetupIconFile=CryptoConexPC\app.ico
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=lowest
UninstallDisplayIcon={app}\CryptoConexPC.exe

[Languages]
Name: "pt"; MessagesFile: "compiler:Languages\Portuguese.isl"

[Files]
Source: "..\publish\*"; DestDir: "{app}"; Flags: recursesubdirs ignoreversion

[Icons]
Name: "{group}\Suporte Técnico"; Filename: "{app}\CryptoConexPC.exe"
Name: "{autodesktop}\Suporte Técnico"; Filename: "{app}\CryptoConexPC.exe"

[Run]
Filename: "{app}\CryptoConexPC.exe"; Description: "Abrir Suporte Técnico"; Flags: nowait postinstall skipifsilent
