# Extracts candidate item ids from mod jar language files (assets/<modid>/lang/en_us.json).
# Output: one "namespace<TAB>id" per line, sorted and unique.
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.IO.Compression.FileSystem

$modsDir = "C:\Users\qwert\.minecraftx\instances\Nebesny Archiv\mods"
$outFile = "C:\Users\qwert\Desktop\GDZ\nebo-archiv\research\jar-items.txt"
$found = New-Object 'System.Collections.Generic.HashSet[string]'

$jars = Get-ChildItem $modsDir -Filter *.jar
$i = 0
foreach ($jar in $jars) {
    $i++
    try {
        $zip = [System.IO.Compression.ZipFile]::OpenRead($jar.FullName)
        try {
            $langs = $zip.Entries | Where-Object { $_.FullName -match '^assets/([^/]+)/lang/en_us\.json$' }
            foreach ($entry in $langs) {
                $ns = [regex]::Match($entry.FullName, '^assets/([^/]+)/').Groups[1].Value
                $reader = New-Object System.IO.StreamReader($entry.Open(), [System.Text.Encoding]::UTF8)
                $text = $reader.ReadToEnd()
                $reader.Close()
                foreach ($m in [regex]::Matches($text, '"(item|block)\.([a-z0-9_]+)\.([^"]+)"\s*:')) {
                    $keyNs = $m.Groups[2].Value
                    if ($keyNs -ne $ns) { continue }
                    $path = $m.Groups[3].Value
                    if ($path -match '\.') { continue }
                    [void]$found.Add("$ns`t$ns`:$path")
                }
            }
        } finally {
            $zip.Dispose()
        }
    } catch {
        Write-Warning "Failed to read $($jar.Name): $($_.Exception.Message)"
    }
    if ($i % 50 -eq 0) { Write-Host "processed $i / $($jars.Count)" }
}

$lines = $found | Sort-Object
[System.IO.File]::WriteAllLines($outFile, $lines, [System.Text.UTF8Encoding]::new($false))
Write-Host "Wrote $($lines.Count) candidate ids to $outFile"
