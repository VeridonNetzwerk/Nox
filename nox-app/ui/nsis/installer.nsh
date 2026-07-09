; Custom NSIS install/uninstall macros for Nox
; Explicitly creates Start Menu and Desktop shortcuts to avoid
; Windows 11 Start Menu issues with the default electron-builder shortcut.
; Also adds a custom finish page that runs the EXE directly (not via a
; potentially sandbox-broken .lnk) and verifies the executable exists.

; Define MUI finish page run BEFORE the MUI pages are inserted.
; This is more reliable than relying on a freshly created shortcut that
; AV/sandbox software may refuse to resolve.
!define MUI_FINISHPAGE_RUN "$INSTDIR\Nox.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Nox starten"

!macro customInstall
  ; Ensure the installer is the owner of the install directory
  SetOutPath "$INSTDIR"

  ; Remove the default electron-builder Start Menu shortcut first
  Delete "$SMPROGRAMS\Nox.lnk"
  ; Also clean up any old folder-based shortcut
  RMDir /r "$SMPROGRAMS\Nox"

  ; If sandboxing/AV extraction is delayed, the EXE might not exist yet
  ; when this macro runs. Only create shortcuts if the target is real.
  IfFileExists "$INSTDIR\Nox.exe" exe_exists no_exe
  exe_exists:

    ; Create explicit Start Menu shortcut with full properties
    CreateShortcut "$SMPROGRAMS\Nox.lnk" \
                   "$INSTDIR\Nox.exe" \
                   "" \
                   "$INSTDIR\Nox.exe" \
                   0 \
                   "" \
                   "" \
                   "Nox - Lokaler KI-Assistent"

    ; Create Desktop shortcut
    CreateShortcut "$DESKTOP\Nox.lnk" \
                   "$INSTDIR\Nox.exe" \
                   "" \
                   "$INSTDIR\Nox.exe" \
                   0 \
                   "" \
                   "" \
                   "Nox - Lokaler KI-Assistent"

    DetailPrint "Shortcuts erstellt: $SMPROGRAMS\Nox.lnk"
    Goto shortcut_done

  no_exe:
    DetailPrint "WARNUNG: Nox.exe nicht gefunden - Shortcuts wurden nicht erstellt."

  shortcut_done:
!macroend

!macro customUnInstall
  ; Remove the shortcuts we created
  Delete "$SMPROGRAMS\Nox.lnk"
  RMDir /r "$SMPROGRAMS\Nox"
  Delete "$DESKTOP\Nox.lnk"
!macroend

; Undefine run-after-finish variables so the uninstaller finish page
; does not show the "Nox starten" checkbox. The installer page was already
; inserted above and has used these defines.
!ifdef MUI_FINISHPAGE_RUN
  !undef MUI_FINISHPAGE_RUN
!endif
!ifdef MUI_FINISHPAGE_RUN_TEXT
  !undef MUI_FINISHPAGE_RUN_TEXT
!endif
!ifdef MUI_FINISHPAGE_RUN_NOTCHECKED
  !undef MUI_FINISHPAGE_RUN_NOTCHECKED
!endif
!ifdef MUI_FINISHPAGE_RUN_FUNCTION
  !undef MUI_FINISHPAGE_RUN_FUNCTION
!endif
!ifdef MUI_FINISHPAGE_RUN_PARAMETERS
  !undef MUI_FINISHPAGE_RUN_PARAMETERS
!endif
!ifdef MUI_UNFINISHPAGE_RUN
  !undef MUI_UNFINISHPAGE_RUN
!endif
!ifdef MUI_UNFINISHPAGE_RUN_TEXT
  !undef MUI_UNFINISHPAGE_RUN_TEXT
!endif
