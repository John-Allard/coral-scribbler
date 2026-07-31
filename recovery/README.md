# Coral Scribbler Chrome Recovery

This package attempts to recover an older Coral Scribbler browser autosave
after a session CSV was accidentally imported over newer work.

## Instructions

1. Keep Google Chrome and the Coral Scribbler tab open and untouched.
2. Extract this entire ZIP file to a folder.
3. Double-click `run-recovery.bat`.
4. Wait for the black PowerShell window to finish.
5. If candidates are found, send
   `Coral_Scribbler_recovery_results.zip` to John.
6. If no candidate is found, send only `recovery_report.txt` initially and
   keep the complete recovery folder.

The script does not modify Chrome's files. It copies all relevant files into a
timestamped `Coral_Scribbler_Recovery_*` folder on the Windows Desktop before
examining the copies.

The `private_browser_snapshot` folder may contain Local Storage records from
other websites. Do not post it publicly or upload it to a general-purpose
chatbot. It should only be shared privately if deeper recovery is required.

Recovery is not guaranteed. The best chance is when the accidental overwrite
was recent, Chrome remains open, and the database has not compacted away the
older write.
