@echo off
setlocal EnableExtensions
set "EXIT_CODE=0"

cd /d "%~dp0"

echo ============================================================
echo   DIALOGY - BUILD E ENVIO DAS IMAGENS DOCKER
echo ============================================================
echo.

where docker >nul 2>&1
if errorlevel 1 (
    echo [ERRO] Docker nao foi encontrado no PATH.
    goto :failure
)

docker info >nul 2>&1
if errorlevel 1 (
    echo [ERRO] O Docker nao esta iniciado ou o usuario nao tem acesso.
    goto :failure
)

if not exist "%~dp0scripts\docker-release.ps1" (
    echo [ERRO] Script scripts\docker-release.ps1 nao encontrado.
    goto :failure
)

if not exist "%~dp0.env" (
    echo [ERRO] Arquivo .env nao encontrado.
    goto :failure
)

set "RELEASE_TAG=%~1"
if not defined RELEASE_TAG (
    echo Digite a tag desejada, por exemplo PDC-1.9.
    echo Deixe em branco para incrementar automaticamente a tag atual.
    set /p "RELEASE_TAG=Tag: "
)

echo.
if defined RELEASE_TAG (
    echo Iniciando release com a tag %RELEASE_TAG%...
    powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\docker-release.ps1" -ReleaseTag "%RELEASE_TAG%"
) else (
    echo Iniciando release com incremento automatico de tag...
    powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\docker-release.ps1"
)

if errorlevel 1 goto :failure

echo.
echo ============================================================
echo   RELEASE CONCLUIDO COM SUCESSO
echo ============================================================
echo As tres imagens foram enviadas e o docker-compose foi atualizado.
goto :finish

:failure
echo.
echo ============================================================
echo   RELEASE FALHOU
echo ============================================================
echo Confira a mensagem de erro acima. Se o build falhou, o script
echo restaurou a tag anterior no .env e no docker-compose.yml.
set "EXIT_CODE=1"

:finish
echo.
pause
exit /b %EXIT_CODE%
