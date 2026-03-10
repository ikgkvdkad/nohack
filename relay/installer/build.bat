@echo off
setlocal

echo Enigma Relay - Installer Builder
echo ==================================
echo.

set RELAY_DIR=%~dp0..
set BUILD_DIR=%~dp0build
set NODE_VERSION=20.11.1

:: Clean previous build
if exist "%BUILD_DIR%" rmdir /s /q "%BUILD_DIR%"
mkdir "%BUILD_DIR%"
mkdir "%BUILD_DIR%\relay"

:: Check for Node.js portable
set NODE_ZIP=%~dp0node-v%NODE_VERSION%-win-x64.zip
if not exist "%NODE_ZIP%" (
    echo Downloading Node.js %NODE_VERSION% portable...
    powershell -NoProfile -Command "Invoke-WebRequest -Uri 'https://nodejs.org/dist/v%NODE_VERSION%/node-v%NODE_VERSION%-win-x64.zip' -OutFile '%NODE_ZIP%'"
    if errorlevel 1 (
        echo Failed to download Node.js. Please download manually:
        echo https://nodejs.org/dist/v%NODE_VERSION%/node-v%NODE_VERSION%-win-x64.zip
        echo Place it in: %~dp0
        pause
        exit /b 1
    )
)

echo Extracting Node.js portable...
powershell -NoProfile -Command "Expand-Archive -Path '%NODE_ZIP%' -DestinationPath '%BUILD_DIR%' -Force"
rename "%BUILD_DIR%\node-v%NODE_VERSION%-win-x64" node

:: Copy relay source
echo Copying relay files...
xcopy /s /e /q "%RELAY_DIR%\src" "%BUILD_DIR%\relay\src\"
copy "%RELAY_DIR%\package.json" "%BUILD_DIR%\relay\"
copy "%RELAY_DIR%\package-lock.json" "%BUILD_DIR%\relay\" 2>nul

:: Install dependencies using portable node
echo Installing dependencies...
"%BUILD_DIR%\node\node.exe" "%BUILD_DIR%\node\node_modules\npm\bin\npm-cli.js" install --prefix "%BUILD_DIR%\relay" --production

:: Create launcher
echo Creating launcher...
(
echo @echo off
echo start /B "" "%%~dp0node\node.exe" "%%~dp0relay\src\server.js" %%*
) > "%BUILD_DIR%\enigma-relay.bat"

:: Create a hidden launcher (no console window)
(
echo Set shell = CreateObject^("WScript.Shell"^)
echo scriptDir = CreateObject^("Scripting.FileSystemObject"^).GetParentFolderName^(WScript.ScriptFullName^)
echo shell.Run """" ^& scriptDir ^& "\node\node.exe"" """ ^& scriptDir ^& "\relay\src\server.js""", 0, False
) > "%BUILD_DIR%\Enigma Relay.vbs"

echo.
echo Build complete! Files are in: %BUILD_DIR%
echo.
echo Next: Run Inno Setup on installer.iss to create the .exe installer.
echo Or distribute the build/ folder directly.
pause
