@echo off
rem Permette di scrivere "make dev" da cmd (o ".\make dev" da PowerShell) senza installare make
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0make.ps1" %*
