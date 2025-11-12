param(
  [int]$ThresholdLines = 50,
  [int]$DebounceMs = 1500
)

function Get-DiffLines {
  $numstat = git diff --numstat 2>$null
  if (-not $numstat) { return 0 }
  $total = 0
  foreach ($line in $numstat) {
    $parts = $line -split "\s+"
    if ($parts.Length -ge 2) {
      $add = [int]($parts[0] -replace "-","0")
      $del = [int]($parts[1] -replace "-","0")
      $total += ($add + $del)
    }
  }
  return $total
}

Write-Host "[autocommit] Watching repo for major changes..."

$fsw = New-Object System.IO.FileSystemWatcher
$fsw.Path = (Get-Location).Path
$fsw.IncludeSubdirectories = $true
$fsw.EnableRaisingEvents = $true
$lastChange = Get-Date

$handler = {
  $script:lastChange = Get-Date
}

Register-ObjectEvent $fsw Changed -SourceIdentifier FSChanged -Action $handler | Out-Null
Register-ObjectEvent $fsw Created -SourceIdentifier FSCreated -Action $handler | Out-Null
Register-ObjectEvent $fsw Deleted -SourceIdentifier FSDeleted -Action $handler | Out-Null
Register-ObjectEvent $fsw Renamed -SourceIdentifier FSRenamed -Action $handler | Out-Null

while ($true) {
  Start-Sleep -Milliseconds $DebounceMs
  $since = (Get-Date) - $lastChange
  if ($since.TotalMilliseconds -lt $DebounceMs) { continue }
  $diff = Get-DiffLines
  if ($diff -ge $ThresholdLines) {
    try {
      git add -A | Out-Null
      $msg = "Auto-commit: $diff line changes"
      git commit -m $msg | Out-Null
      Write-Host "[autocommit] $msg"
    } catch {
      # ignore
    }
    # reset timer
    $lastChange = Get-Date
  }
}

