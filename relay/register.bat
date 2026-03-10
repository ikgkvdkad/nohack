@echo off
echo Registering .enigma file association...
echo.

set RELAY_DIR=%~dp0
set NODE_PATH=node
set SERVER_PATH=%RELAY_DIR%src\server.js

:: Register .enigma file type
reg add "HKCU\Software\Classes\.enigma" /ve /d "EnigmaFile" /f >nul 2>&1
reg add "HKCU\Software\Classes\EnigmaFile" /ve /d "Enigma Encrypted Message" /f >nul 2>&1
reg add "HKCU\Software\Classes\EnigmaFile\shell\open\command" /ve /d "\"%NODE_PATH%\" \"%SERVER_PATH%\" \"%%1\"" /f >nul 2>&1

echo Done! Double-clicking .enigma files will now send them to the Enigma Relay.
echo.
pause
