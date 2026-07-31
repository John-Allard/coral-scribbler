[CmdletBinding()]
param(
    [string]$OutputDirectory = ""
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = "Stop"

$script:Messages = New-Object System.Collections.Generic.List[string]
$script:Candidates = New-Object System.Collections.Generic.List[object]
$script:CandidateHashes = New-Object System.Collections.Generic.HashSet[string]
$script:Utf8 = New-Object System.Text.UTF8Encoding($false)
$script:Latin1 = [System.Text.Encoding]::GetEncoding(28591)
$script:JsonMarker = $script:Utf8.GetBytes('{"schema_version":"coral-annotations/v2"')

function Write-Report {
    param([string]$Message)
    $timestamp = Get-Date -Format "HH:mm:ss"
    $line = "[$timestamp] $Message"
    $script:Messages.Add($line)
    Write-Host $line
}

function Get-SafeName {
    param([string]$Value)
    if ([string]::IsNullOrWhiteSpace($Value)) {
        return "unknown"
    }
    return (($Value -replace '[^A-Za-z0-9._-]+', '_').Trim('_'))
}

function Get-Sha256 {
    param([byte[]]$Bytes)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $hash = $sha.ComputeHash($Bytes)
        return ([System.BitConverter]::ToString($hash)).Replace("-", "").ToLowerInvariant()
    }
    finally {
        $sha.Dispose()
    }
}

function Copy-LiveFile {
    param(
        [string]$Source,
        [string]$Destination
    )
    $destinationParent = Split-Path -Parent $Destination
    if (-not (Test-Path -LiteralPath $destinationParent)) {
        New-Item -ItemType Directory -Path $destinationParent -Force | Out-Null
    }

    $share = [System.IO.FileShare]::ReadWrite -bor [System.IO.FileShare]::Delete
    $inputStream = $null
    $outputStream = $null
    try {
        $inputStream = [System.IO.File]::Open(
            $Source,
            [System.IO.FileMode]::Open,
            [System.IO.FileAccess]::Read,
            $share
        )
        $outputStream = [System.IO.File]::Open(
            $Destination,
            [System.IO.FileMode]::Create,
            [System.IO.FileAccess]::Write,
            [System.IO.FileShare]::None
        )
        $inputStream.CopyTo($outputStream)
        return $true
    }
    catch {
        Write-Report "Could not copy $Source ($($_.Exception.Message))"
        return $false
    }
    finally {
        if ($null -ne $outputStream) {
            $outputStream.Dispose()
        }
        if ($null -ne $inputStream) {
            $inputStream.Dispose()
        }
    }
}

function Copy-LiveDirectory {
    param(
        [string]$Source,
        [string]$Destination
    )
    if (-not (Test-Path -LiteralPath $Source)) {
        return 0
    }
    $copied = 0
    $sourcePrefixLength = $Source.TrimEnd('\').Length
    foreach ($file in Get-ChildItem -LiteralPath $Source -File -Recurse -Force -ErrorAction SilentlyContinue) {
        $relative = $file.FullName.Substring($sourcePrefixLength) -replace '^[\\/]+', ''
        if (Copy-LiveFile -Source $file.FullName -Destination (Join-Path $Destination $relative)) {
            $copied += 1
        }
    }
    return $copied
}

function Read-Varint32 {
    param(
        [byte[]]$Bytes,
        [ref]$Position,
        [int]$Limit
    )
    [uint64]$result = 0
    for ($shift = 0; $shift -le 28; $shift += 7) {
        if ($Position.Value -ge $Limit) {
            return $null
        }
        [byte]$current = $Bytes[$Position.Value]
        $Position.Value += 1
        $result = $result -bor ([uint64]($current -band 0x7f) -shl $shift)
        if (($current -band 0x80) -eq 0) {
            return [long]$result
        }
    }
    return $null
}

function Copy-ByteRange {
    param(
        [byte[]]$Bytes,
        [int]$Start,
        [int]$Length
    )
    $result = New-Object byte[] $Length
    [System.Array]::Copy($Bytes, $Start, $result, 0, $Length)
    return $result
}

function Test-CoralStorageKey {
    param([byte[]]$KeyBytes)
    if ($KeyBytes.Length -eq 0) {
        return $false
    }
    $latinText = $script:Latin1.GetString($KeyBytes)
    if ($latinText.IndexOf("coral-scribbler:", [System.StringComparison]::OrdinalIgnoreCase) -ge 0) {
        return $true
    }
    $utf8Text = $script:Utf8.GetString($KeyBytes)
    return $utf8Text.IndexOf("coral-scribbler:", [System.StringComparison]::OrdinalIgnoreCase) -ge 0
}

function Get-SessionSummary {
    param($Session)
    $target = 50
    if ($null -ne $Session.dot_target_count) {
        $target = [int]$Session.dot_target_count
    }
    $imageCount = 0
    $completeCount = 0
    $classifiedCount = 0
    if ($null -ne $Session.images) {
        foreach ($property in $Session.images.PSObject.Properties) {
            $imageCount += 1
            $imageClassified = 0
            if ($null -ne $property.Value.dots) {
                foreach ($dot in @($property.Value.dots)) {
                    if ($null -ne $dot.class_id -and -not [string]::IsNullOrWhiteSpace([string]$dot.class_id)) {
                        $imageClassified += 1
                        $classifiedCount += 1
                    }
                }
            }
            if ($imageClassified -ge $target) {
                $completeCount += 1
            }
        }
    }
    return [PSCustomObject]@{
        ImageCount = $imageCount
        CompleteCount = $completeCount
        ClassifiedCount = $classifiedCount
        UpdatedAt = [string]$Session.updated_at_utc
        SessionId = [string]$Session.session_id
        DatasetName = [string]$Session.dataset_name
    }
}

function Add-CandidateText {
    param(
        [string]$Text,
        [string]$Source
    )
    if ([string]::IsNullOrWhiteSpace($Text)) {
        return
    }
    $start = $Text.IndexOf('{"schema_version":"coral-annotations/v2"', [System.StringComparison]::Ordinal)
    if ($start -lt 0) {
        return
    }
    $json = $Text.Substring($start).Trim().Trim([char]0)
    try {
        $session = $json | ConvertFrom-Json
    }
    catch {
        return
    }
    if (
        [string]$session.schema_version -ne "coral-annotations/v2" -or
        $null -eq $session.images
    ) {
        return
    }

    $jsonBytes = $script:Utf8.GetBytes($json)
    $hash = Get-Sha256 -Bytes $jsonBytes
    if (-not $script:CandidateHashes.Add($hash)) {
        return
    }
    $summary = Get-SessionSummary -Session $session
    $candidate = [PSCustomObject]@{
        Json = $json
        Hash = $hash
        Source = $Source
        Summary = $summary
    }
    $script:Candidates.Add($candidate)
    Write-Report (
        "Recovered candidate: {0} complete images, {1} classified dots, updated {2}" -f
        $summary.CompleteCount,
        $summary.ClassifiedCount,
        $summary.UpdatedAt
    )
}

function Add-CandidateBytes {
    param(
        [byte[]]$ValueBytes,
        [string]$Source
    )
    if ($ValueBytes.Length -eq 0) {
        return
    }

    $texts = New-Object System.Collections.Generic.List[string]
    $texts.Add($script:Utf8.GetString($ValueBytes))
    $texts.Add($script:Latin1.GetString($ValueBytes))
    if ($ValueBytes[0] -eq 1 -and $ValueBytes.Length -gt 1) {
        $texts.Add($script:Latin1.GetString($ValueBytes, 1, $ValueBytes.Length - 1))
    }
    if ($ValueBytes[0] -eq 0 -and $ValueBytes.Length -gt 2) {
        $texts.Add([System.Text.Encoding]::Unicode.GetString($ValueBytes, 1, $ValueBytes.Length - 1))
    }
    foreach ($text in $texts) {
        Add-CandidateText -Text $text -Source $Source
    }
}

function Process-WriteBatch {
    param(
        [byte[]]$Batch,
        [string]$Source
    )
    if ($Batch.Length -lt 12) {
        return
    }
    [uint32]$count = [System.BitConverter]::ToUInt32($Batch, 8)
    $position = 12
    for ($recordIndex = 0; $recordIndex -lt $count; $recordIndex += 1) {
        if ($position -ge $Batch.Length) {
            return
        }
        [byte]$tag = $Batch[$position]
        $position += 1
        $positionRef = [ref]$position
        $keyLength = Read-Varint32 -Bytes $Batch -Position $positionRef -Limit $Batch.Length
        if ($null -eq $keyLength -or $keyLength -lt 0 -or $position + $keyLength -gt $Batch.Length) {
            return
        }
        $keyBytes = Copy-ByteRange -Bytes $Batch -Start $position -Length ([int]$keyLength)
        $position += [int]$keyLength

        if ($tag -eq 0) {
            continue
        }
        if ($tag -ne 1) {
            return
        }
        $positionRef = [ref]$position
        $valueLength = Read-Varint32 -Bytes $Batch -Position $positionRef -Limit $Batch.Length
        if ($null -eq $valueLength -or $valueLength -lt 0 -or $position + $valueLength -gt $Batch.Length) {
            return
        }
        if (Test-CoralStorageKey -KeyBytes $keyBytes) {
            $valueBytes = Copy-ByteRange -Bytes $Batch -Start $position -Length ([int]$valueLength)
            Add-CandidateBytes -ValueBytes $valueBytes -Source $Source
        }
        $position += [int]$valueLength
    }
}

function Read-LevelDbLog {
    param([string]$Path)
    try {
        $bytes = [System.IO.File]::ReadAllBytes($Path)
    }
    catch {
        Write-Report "Could not read copied log $Path ($($_.Exception.Message))"
        return
    }

    $blockSize = 32768
    $headerSize = 7
    $offset = 0
    $fragmented = $null
    while ($offset + $headerSize -le $bytes.Length) {
        $blockRemaining = $blockSize - ($offset % $blockSize)
        if ($blockRemaining -lt $headerSize) {
            $offset += $blockRemaining
            continue
        }
        $length = [int]$bytes[$offset + 4] + ([int]$bytes[$offset + 5] -shl 8)
        $recordType = [int]$bytes[$offset + 6]
        if ($recordType -eq 0 -and $length -eq 0) {
            $offset += $blockRemaining
            $fragmented = $null
            continue
        }
        if ($length -lt 0 -or $length -gt ($blockRemaining - $headerSize)) {
            $offset += $blockRemaining
            $fragmented = $null
            continue
        }
        $payloadStart = $offset + $headerSize
        if ($payloadStart + $length -gt $bytes.Length) {
            break
        }
        $payload = Copy-ByteRange -Bytes $bytes -Start $payloadStart -Length $length
        $offset = $payloadStart + $length

        switch ($recordType) {
            1 {
                Process-WriteBatch -Batch $payload -Source "$Path (full log record)"
                $fragmented = $null
            }
            2 {
                if ($null -ne $fragmented) {
                    $fragmented.Dispose()
                }
                $fragmented = New-Object System.IO.MemoryStream
                $fragmented.Write($payload, 0, $payload.Length)
            }
            3 {
                if ($null -ne $fragmented) {
                    $fragmented.Write($payload, 0, $payload.Length)
                }
            }
            4 {
                if ($null -ne $fragmented) {
                    $fragmented.Write($payload, 0, $payload.Length)
                    Process-WriteBatch -Batch $fragmented.ToArray() -Source "$Path (fragmented log record)"
                    $fragmented.Dispose()
                    $fragmented = $null
                }
            }
            default {
                $fragmented = $null
            }
        }
    }
    if ($null -ne $fragmented) {
        $fragmented.Dispose()
    }
}

function Find-PatternOffsets {
    param(
        [byte[]]$Bytes,
        [byte[]]$Pattern
    )
    $offsets = New-Object System.Collections.Generic.List[int]
    if ($Pattern.Length -eq 0 -or $Bytes.Length -lt $Pattern.Length) {
        return $offsets
    }
    $limit = $Bytes.Length - $Pattern.Length
    for ($index = 0; $index -le $limit; $index += 1) {
        if ($Bytes[$index] -ne $Pattern[0]) {
            continue
        }
        $matched = $true
        for ($patternIndex = 1; $patternIndex -lt $Pattern.Length; $patternIndex += 1) {
            if ($Bytes[$index + $patternIndex] -ne $Pattern[$patternIndex]) {
                $matched = $false
                break
            }
        }
        if ($matched) {
            $offsets.Add($index)
        }
    }
    return $offsets
}

function Get-ContiguousJsonBytes {
    param(
        [byte[]]$Bytes,
        [int]$Start
    )
    $depth = 0
    $inString = $false
    $escaped = $false
    for ($index = $Start; $index -lt $Bytes.Length; $index += 1) {
        [byte]$current = $Bytes[$index]
        if ($inString) {
            if ($escaped) {
                $escaped = $false
            }
            elseif ($current -eq 92) {
                $escaped = $true
            }
            elseif ($current -eq 34) {
                $inString = $false
            }
            continue
        }
        if ($current -eq 34) {
            $inString = $true
        }
        elseif ($current -eq 123) {
            $depth += 1
        }
        elseif ($current -eq 125) {
            $depth -= 1
            if ($depth -eq 0) {
                return Copy-ByteRange -Bytes $Bytes -Start $Start -Length ($index - $Start + 1)
            }
        }
    }
    return $null
}

function Scan-RawFile {
    param([string]$Path)
    try {
        $file = Get-Item -LiteralPath $Path
        if ($file.Length -gt 536870912) {
            Write-Report "Skipping raw scan of file over 512 MB: $Path"
            return
        }
        $bytes = [System.IO.File]::ReadAllBytes($Path)
    }
    catch {
        Write-Report "Could not scan copied file $Path ($($_.Exception.Message))"
        return
    }
    foreach ($offset in Find-PatternOffsets -Bytes $bytes -Pattern $script:JsonMarker) {
        $jsonBytes = Get-ContiguousJsonBytes -Bytes $bytes -Start $offset
        if ($null -ne $jsonBytes) {
            Add-CandidateBytes -ValueBytes $jsonBytes -Source "$Path (contiguous raw scan)"
        }
    }
}

function Save-Candidates {
    param([string]$Root)
    $candidateDirectory = Join-Path $Root "recovered_candidates"
    New-Item -ItemType Directory -Path $candidateDirectory -Force | Out-Null

    $ordered = @($script:Candidates | Sort-Object {
        $_.Summary.ClassifiedCount
    } -Descending)
    $index = 0
    foreach ($candidate in $ordered) {
        $index += 1
        $summary = $candidate.Summary
        $filename = (
            "candidate_{0:D2}_{1}_complete_{2}_dots_{3}.json" -f
            $index,
            $summary.CompleteCount,
            $summary.ClassifiedCount,
            $candidate.Hash.Substring(0, 8)
        )
        [System.IO.File]::WriteAllText(
            (Join-Path $candidateDirectory $filename),
            $candidate.Json,
            $script:Utf8
        )
        $metadata = @(
            "File: $filename",
            "Dataset: $($summary.DatasetName)",
            "Session ID: $($summary.SessionId)",
            "Updated: $($summary.UpdatedAt)",
            "Images: $($summary.ImageCount)",
            "Complete images: $($summary.CompleteCount)",
            "Classified dots: $($summary.ClassifiedCount)",
            "Source: $($candidate.Source)",
            "SHA-256: $($candidate.Hash)"
        ) -join [Environment]::NewLine
        [System.IO.File]::WriteAllText(
            (Join-Path $candidateDirectory ($filename -replace '\.json$', '.txt')),
            $metadata,
            $script:Utf8
        )
    }
    return $candidateDirectory
}

Write-Host ""
Write-Host "Coral Scribbler Chrome session recovery" -ForegroundColor Cyan
Write-Host "Keep Chrome and the Coral Scribbler tab OPEN while this runs." -ForegroundColor Yellow
Write-Host "This script reads and copies files; it does not change Chrome data."
Write-Host ""

if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
    $desktop = [Environment]::GetFolderPath("Desktop")
    $OutputDirectory = Join-Path $desktop ("Coral_Scribbler_Recovery_" + (Get-Date -Format "yyyy-MM-dd_HHmmss"))
}
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
$snapshotDirectory = Join-Path $OutputDirectory "private_browser_snapshot"
New-Item -ItemType Directory -Path $snapshotDirectory -Force | Out-Null

Write-Report "Recovery folder: $OutputDirectory"
$chromeRoot = Join-Path $env:LOCALAPPDATA "Google\Chrome\User Data"
if (-not (Test-Path -LiteralPath $chromeRoot)) {
    Write-Report "Chrome user-data folder was not found at $chromeRoot"
    Write-Report "No recovery was attempted. Confirm that Google Chrome, not Edge, was used."
}
else {
    $profiles = @(
        Get-ChildItem -LiteralPath $chromeRoot -Directory -Force |
        Where-Object {
            $_.Name -eq "Default" -or
            $_.Name -like "Profile *" -or
            $_.Name -eq "Guest Profile"
        }
    )
    Write-Report "Found $($profiles.Count) Chrome profile folder(s)."
    foreach ($profile in $profiles) {
        $profileDestination = Join-Path $snapshotDirectory (Get-SafeName -Value $profile.Name)
        $levelDbSource = Join-Path $profile.FullName "Local Storage\leveldb"
        if (Test-Path -LiteralPath $levelDbSource) {
            $levelDbDestination = Join-Path $profileDestination "Local Storage\leveldb"
            $copied = Copy-LiveDirectory -Source $levelDbSource -Destination $levelDbDestination
            Write-Report "Copied $copied LevelDB file(s) from Chrome profile $($profile.Name)."
        }

        foreach ($sqliteFile in Get-ChildItem -LiteralPath $profile.FullName -File -Filter "LocalStorage*" -Force -ErrorAction SilentlyContinue) {
            $sqliteDestination = Join-Path $profileDestination $sqliteFile.Name
            if (Copy-LiveFile -Source $sqliteFile.FullName -Destination $sqliteDestination) {
                Write-Report "Copied possible SQLite storage file $($sqliteFile.Name) from $($profile.Name)."
            }
        }
    }

    $copiedFiles = @(
        Get-ChildItem -LiteralPath $snapshotDirectory -File -Recurse -Force -ErrorAction SilentlyContinue
    )
    Write-Report "Snapshot contains $($copiedFiles.Count) copied file(s)."

    foreach ($logFile in $copiedFiles | Where-Object { $_.Extension -eq ".log" }) {
        Read-LevelDbLog -Path $logFile.FullName
    }
    foreach ($file in $copiedFiles) {
        Scan-RawFile -Path $file.FullName
    }
}

$candidateDirectory = Save-Candidates -Root $OutputDirectory
$reportPath = Join-Path $OutputDirectory "recovery_report.txt"
$summaryLines = New-Object System.Collections.Generic.List[string]
foreach ($message in $script:Messages) {
    $summaryLines.Add($message)
}
$summaryLines.Add("")
$summaryLines.Add("Validated Coral session candidates: $($script:Candidates.Count)")
if ($script:Candidates.Count -gt 0) {
    $summaryLines.Add("Send the recovered_candidates ZIP to John. The candidate with the largest classified-dot count is listed first.")
}
else {
    $summaryLines.Add("No intact candidate was found automatically.")
    $summaryLines.Add("Keep the entire recovery folder. The private_browser_snapshot may support deeper recovery.")
    $summaryLines.Add("Do not share the private snapshot publicly because Chrome Local Storage can contain data from other sites.")
}
[System.IO.File]::WriteAllLines($reportPath, $summaryLines, $script:Utf8)

$shareDirectory = Join-Path $OutputDirectory "share_with_john"
New-Item -ItemType Directory -Path $shareDirectory -Force | Out-Null
Copy-Item -LiteralPath $reportPath -Destination $shareDirectory -Force
if ($script:Candidates.Count -gt 0) {
    Copy-Item -LiteralPath $candidateDirectory -Destination $shareDirectory -Recurse -Force
}
$shareZip = Join-Path $OutputDirectory "Coral_Scribbler_recovery_results.zip"
if (Test-Path -LiteralPath $shareZip) {
    Remove-Item -LiteralPath $shareZip -Force
}
Compress-Archive -Path (Join-Path $shareDirectory "*") -DestinationPath $shareZip -CompressionLevel Optimal

Write-Host ""
if ($script:Candidates.Count -gt 0) {
    Write-Host "Recovery candidates were found." -ForegroundColor Green
    Write-Host "Send this file to John:"
    Write-Host "  $shareZip" -ForegroundColor Cyan
}
else {
    Write-Host "No intact session was recovered automatically." -ForegroundColor Yellow
    Write-Host "Do not delete this folder; it contains the forensic snapshot:"
    Write-Host "  $OutputDirectory" -ForegroundColor Cyan
    Write-Host "Send John recovery_report.txt first. Do not send the private snapshot publicly."
}
Write-Host ""
Write-Host "You may now close this window. Leave the Coral Scribbler tab untouched until John confirms the result."
