param(
    [string]$Version = "v26.10.31",
    [string]$Destination = (Join-Path $PSScriptRoot "../resources/core")
)
$ErrorActionPreference = "Stop"
if ($Version -notmatch '^v[0-9]+(\.[0-9]+){2}$') { throw "Invalid Xray version: $Version" }
$name = "Xray-windows-64.zip"
$url = "https://github.com/XTLS/Xray-core/releases/download/$Version/$name"
$api = "https://api.github.com/repos/XTLS/Xray-core/releases/tags/$Version"
$temp = Join-Path ([IO.Path]::GetTempPath()) ("mahyar-xray-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force $temp | Out-Null
try {
    $headers = @{ "User-Agent" = "Mahyar-VPN-build"; "Accept" = "application/vnd.github+json" }
    $release = Invoke-RestMethod -Uri $api -Headers $headers
    $asset = @($release.assets | Where-Object { $_.name -eq $name -and $_.state -eq 'uploaded' })
    if ($asset.Count -ne 1 -or $asset[0].digest -notmatch '^sha256:([a-fA-F0-9]{64})$') {
        throw "Official release is missing a unique SHA-256 digest for $name."
    }
    $expected = $Matches[1].ToLowerInvariant()
    $zip = Join-Path $temp $name
    $downloaded = $false
    for ($try = 1; $try -le 3; $try++) {
        try {
            Invoke-WebRequest -Uri $url -OutFile $zip -Headers @{ "User-Agent" = "Mahyar-VPN-build" } -TimeoutSec 180
            $downloaded = $true
            break
        } catch {
            if ($try -eq 3) { throw }
            Start-Sleep -Seconds (2 * $try)
        }
    }
    if (-not $downloaded) { throw "Xray download failed." }
    $actual = (Get-FileHash -Algorithm SHA256 $zip).Hash.ToLowerInvariant()
    if ($actual -ne $expected) { throw "Xray archive SHA-256 mismatch. Refusing to install." }
    $unpacked = Join-Path $temp 'files'
    Expand-Archive -Path $zip -DestinationPath $unpacked
    foreach ($file in @("xray.exe", "geoip.dat", "geosite.dat")) {
        $source = Join-Path $unpacked $file
        if (!(Test-Path -LiteralPath $source -PathType Leaf) -or (Get-Item -LiteralPath $source).Length -eq 0) {
            throw "Official archive does not contain non-empty $file."
        }
    }
    New-Item -ItemType Directory -Force $Destination | Out-Null
    foreach ($file in @("xray.exe", "geoip.dat", "geosite.dat")) {
        Copy-Item -LiteralPath (Join-Path $unpacked $file) -Destination (Join-Path $Destination $file) -Force
    }
    Write-Host "Installed verified $Version ($actual) into $Destination"
    Write-Host "Archive hash is compared with the GitHub release metadata, not a separately pinned signature."
} finally {
    Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue
}
