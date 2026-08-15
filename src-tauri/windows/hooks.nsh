!macro NSIS_HOOK_POSTINSTALL
  DetailPrint "正在安装 FFmpeg 视频引擎..."
  nsExec::ExecToLog '"$INSTDIR\framecut.exe" --install-ffmpeg "$INSTDIR\ffmpeg-release-essentials.7z" "$INSTDIR\ffmpeg\bin"'
  Pop $0
  StrCmp $0 "0" framecut_ffmpeg_done
  MessageBox MB_ICONSTOP|MB_OK "FFmpeg 解压失败，安装无法继续。请检查磁盘空间后重试。"
  Abort
  framecut_ffmpeg_done:
  Delete "$INSTDIR\ffmpeg-release-essentials.7z"
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  RMDir /r "$INSTDIR\ffmpeg"
!macroend
