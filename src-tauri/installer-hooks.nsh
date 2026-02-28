!macro NSIS_HOOK_PREINSTALL
  ; Keep user-selected non-C paths, but move default C installs to D for easier data management.
  StrCpy $0 "$INSTDIR" 3
  StrCmp "$0" "C:\" 0 +2
  StrCpy $INSTDIR "D:\Novel-IDE"
!macroend
