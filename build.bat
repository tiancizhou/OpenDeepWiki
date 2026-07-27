@echo off
chcp 65001 >nul
setlocal EnableExtensions EnableDelayedExpansion

REM ========== Config ==========
if not defined REGISTRY set "REGISTRY=192.168.180.146:8082"
if not defined IMAGE_NAMESPACE set "IMAGE_NAMESPACE=open-deepwiki"
if not defined BACKEND_IMAGE_NAME set "BACKEND_IMAGE_NAME=%IMAGE_NAMESPACE%/opendeepwiki"
if not defined WEB_IMAGE_NAME set "WEB_IMAGE_NAME=%IMAGE_NAMESPACE%/opendeepwiki-web"
if not defined POSTGRES_SOURCE_IMAGE set "POSTGRES_SOURCE_IMAGE=postgres:16-alpine"
if not defined POSTGRES_IMAGE_NAME set "POSTGRES_IMAGE_NAME=%IMAGE_NAMESPACE%/postgres"
REM Optional auto-login credentials.
REM Prefer setting these as environment variables instead of saving a password in this file.
if not defined REGISTRY_USERNAME set "REGISTRY_USERNAME="
if not defined REGISTRY_PASSWORD set "REGISTRY_PASSWORD="
REM =============================

set "ENV=%~1"
if "%ENV%"=="" set "ENV=test"
if "%ENV%"=="test" goto :env_ok
if "%ENV%"=="prod" goto :env_ok
echo [ERROR] Unsupported env: %ENV% (only test or prod)
goto :end

:env_ok
set "TARGET=%~2"
if "%TARGET%"=="" goto :select_target
goto :validate_target

:select_target
echo.
echo Select build target:
echo   [1] all      - backend + web + postgres
echo   [2] backend  - backend image only
echo   [3] web      - web image only
echo   [4] postgres - postgres image only
echo.
choice /C 1234 /N /M "Choose target [1-4]: "
if errorlevel 4 set "TARGET=postgres" & goto :validate_target
if errorlevel 3 set "TARGET=web" & goto :validate_target
if errorlevel 2 set "TARGET=backend" & goto :validate_target
set "TARGET=all"

:validate_target
if "%TARGET%"=="all" goto :target_ok
if "%TARGET%"=="web" goto :target_ok
if "%TARGET%"=="backend" goto :target_ok
if "%TARGET%"=="postgres" goto :target_ok
echo [ERROR] Unsupported target: %TARGET% (only all, backend, web or postgres)
goto :end

:target_ok
set "IMAGE_TAG=%ENV%"
set "BACKEND_REMOTE_IMAGE=%REGISTRY%/%BACKEND_IMAGE_NAME%:%IMAGE_TAG%"
set "WEB_REMOTE_IMAGE=%REGISTRY%/%WEB_IMAGE_NAME%:%IMAGE_TAG%"
set "POSTGRES_REMOTE_IMAGE=%REGISTRY%/%POSTGRES_IMAGE_NAME%:16-alpine"

echo ========================================
echo   Env:    %ENV%
echo   Target: %TARGET%
echo   Backend: %BACKEND_REMOTE_IMAGE%
echo   Web:     %WEB_REMOTE_IMAGE%
echo   Postgres:%POSTGRES_REMOTE_IMAGE%
echo ========================================
echo Usage:
echo   build.bat test web       ^(web only^)
echo   build.bat test backend   ^(backend only^)
echo   build.bat test all       ^(all images^)
echo ========================================

echo [1] Logging in to registry ...
if "%REGISTRY_USERNAME%"=="" (
    set /p "REGISTRY_USERNAME=Registry username (leave empty for Docker prompt): "
)
if "%REGISTRY_USERNAME%"=="" (
    docker login "%REGISTRY%"
) else (
    if not "%REGISTRY_PASSWORD%"=="" (
        powershell -NoProfile -ExecutionPolicy Bypass -Command "[Console]::Out.Write($env:REGISTRY_PASSWORD)" | docker login "%REGISTRY%" --username "%REGISTRY_USERNAME%" --password-stdin
    ) else (
        powershell -NoProfile -ExecutionPolicy Bypass -Command "$p = Read-Host 'Registry password' -AsSecureString; $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($p); try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }" | docker login "%REGISTRY%" --username "%REGISTRY_USERNAME%" --password-stdin
    )
)
if errorlevel 1 (
    echo [ERROR] Login failed
    goto :end
)

if "%TARGET%"=="web" goto :build_web
if "%TARGET%"=="postgres" goto :push_postgres

echo [2] Building backend image (platform: linux/amd64) ...
docker buildx build --platform linux/amd64 -f "src/OpenDeepWiki/Dockerfile" -t "%BACKEND_REMOTE_IMAGE%" --load .
if errorlevel 1 (
    echo [ERROR] Backend build failed
    goto :end
)

echo [3] Pushing backend image ...
docker push "%BACKEND_REMOTE_IMAGE%"
if errorlevel 1 (
    echo [ERROR] Backend push failed
    goto :end
)

if "%TARGET%"=="backend" goto :done

:build_web
echo [4] Building web image (platform: linux/amd64) ...
docker buildx build --platform linux/amd64 -f "web/Dockerfile" -t "%WEB_REMOTE_IMAGE%" --load "web"
if errorlevel 1 (
    echo [ERROR] Web build failed
    goto :end
)

echo [5] Pushing web image ...
docker push "%WEB_REMOTE_IMAGE%"
if errorlevel 1 (
    echo [ERROR] Web push failed
    goto :end
)

if "%TARGET%"=="web" goto :done

:push_postgres
echo [6] Pulling postgres image ...
docker pull "%POSTGRES_SOURCE_IMAGE%"
if errorlevel 1 (
    echo [ERROR] Postgres pull failed
    goto :end
)

echo [7] Tagging postgres image ...
docker tag "%POSTGRES_SOURCE_IMAGE%" "%POSTGRES_REMOTE_IMAGE%"
if errorlevel 1 (
    echo [ERROR] Postgres tag failed
    goto :end
)

echo [8] Pushing postgres image ...
docker push "%POSTGRES_REMOTE_IMAGE%"
if errorlevel 1 (
    echo [ERROR] Postgres push failed
    goto :end
)

:done
echo ========================================
echo [DONE]
if "%TARGET%"=="all" echo   %BACKEND_REMOTE_IMAGE%
if "%TARGET%"=="all" echo   %WEB_REMOTE_IMAGE%
if "%TARGET%"=="all" echo   %POSTGRES_REMOTE_IMAGE%
if "%TARGET%"=="backend" echo   %BACKEND_REMOTE_IMAGE%
if "%TARGET%"=="web" echo   %WEB_REMOTE_IMAGE%
if "%TARGET%"=="postgres" echo   %POSTGRES_REMOTE_IMAGE%
echo ========================================

:end
pause
