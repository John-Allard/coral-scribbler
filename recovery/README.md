# Coral Scribbler Chrome Recovery

This package attempts to recover an older Coral Scribbler browser autosave
after a session CSV was accidentally imported over newer work.

## Before starting

1. Keep Google Chrome open.
2. Keep the Coral Scribbler tab containing the overwritten session open.
3. Do not reload, close, or continue using that tab until John has checked the
   recovery results.
4. Download the ZIP. Before extracting it, right-click the downloaded ZIP,
   select **Properties**, and look near the bottom of the **General** tab. If
   Windows shows an **Unblock** checkbox, select it, click **Apply**, and then
   click **OK**. If no Unblock option appears, continue normally.
5. In File Explorer, right-click the ZIP and select **Extract All**. Extract all
   three files into one ordinary folder. Do not run the batch file from inside
   the ZIP preview.

The extracted folder can be anywhere convenient, including Downloads or the
Desktop. Its location does not affect where the results are saved. Keep
`run-recovery.bat` and `recover-coral-scribbler.ps1` together in that folder.

## Run the recovery

1. Double-click `run-recovery.bat`.
2. A black command window titled **Coral Scribbler session recovery** will
   open. No administrator access is required.
3. If Windows still asks whether to run the downloaded file, proceed only if
   this is the package received from John. If Windows offers **More info**,
   select it and then select **Run anyway**. Do not disable Windows Defender or
   other security protections.
4. Leave the black window open while timestamped progress messages appear.
   The script may take a few minutes.
5. At the end, the window remains open and says **Press any key to continue**.
   Do not press a key until the result message has been read or photographed.

## Find the results

The script creates a folder directly on the Windows Desktop with a name like:

`Coral_Scribbler_Recovery_2026-07-30_223000`

This is the same Desktop shown in File Explorer, including a OneDrive-managed
Desktop if Windows redirects it there. The script opens the folder
automatically when it finishes. The full folder path is also printed near the
top of the black window after **Recovery folder:**.

## If recovery succeeds

The black window says:

`Recovery candidates were found.`

It then prints **Send this file to John:** followed by the full path. Send this
file from the recovery folder:

`Coral_Scribbler_recovery_results.zip`

Leave Chrome and the Coral Scribbler tab open until John confirms whether the
100-image session is among the candidates.

## If no session is recovered

The black window says:

`No intact session was recovered automatically.`

Send John only this file initially:

`recovery_report.txt`

Do not delete or rename the complete `Coral_Scribbler_Recovery_*` folder. It
contains a private snapshot that may permit a deeper manual recovery attempt.

## If the script reports an error

The black window displays **RECOVERY SCRIPT ERROR**. Take a screenshot showing
all visible text in that window and send the screenshot to John. Keep Chrome,
the Coral Scribbler tab, and the recovery folder untouched.

The script does not modify Chrome's files. It copies all relevant files into
the timestamped Desktop folder before examining the copies.

The `private_browser_snapshot` folder may contain Local Storage records from
other websites. Do not post it publicly or upload it to a general-purpose
chatbot. It should only be shared privately if deeper recovery is required.

Recovery is not guaranteed. The best chance is when the accidental overwrite
was recent, Chrome remains open, and the database has not compacted away the
older write.
