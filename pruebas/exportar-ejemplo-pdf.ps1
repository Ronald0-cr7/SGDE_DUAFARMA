$ErrorActionPreference = 'Stop'
$entrada = Join-Path $PSScriptRoot 'Kardex_D00068_ejemplo.xlsx'
$salida = Join-Path $PSScriptRoot 'Kardex_D00068_ejemplo.pdf'
$excel = $null
$libro = $null
try {
    $excel = New-Object -ComObject Excel.Application
    $excel.Visible = $false
    $excel.DisplayAlerts = $false
    $libro = $excel.Workbooks.Open($entrada, 0, $true)
    $libro.ExportAsFixedFormat(0, $salida)
    Get-Item -LiteralPath $salida | Select-Object FullName, Length
} finally {
    if ($null -ne $libro) {
        $libro.Close($false)
        [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($libro)
    }
    if ($null -ne $excel) {
        $excel.Quit()
        [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($excel)
    }
}
