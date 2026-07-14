param(
  [Parameter(Mandatory = $true)][string]$BaseUrl,
  [Parameter(Mandatory = $true)][string]$Secret,
  [Parameter(Mandatory = $true)][string]$PdfPath,
  [Parameter(Mandatory = $true)][string]$SummaryId,
  [Parameter(Mandatory = $true)][int]$ClientId,
  [Parameter(Mandatory = $true)][int]$CurrentYear,
  [string]$KeyId = 'pvs-web2',
  [string]$OutputPath = '.\downloaded-summary.pdf'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$resolvedPdfPath = (Resolve-Path -LiteralPath $PdfPath).Path
$bytes = [System.IO.File]::ReadAllBytes($resolvedPdfPath)
$sha = [System.Security.Cryptography.SHA256]::Create()
try {
  $bodyHash = (($sha.ComputeHash($bytes) | ForEach-Object { $_.ToString('x2') }) -join '')
  $emptyHash = (($sha.ComputeHash([byte[]]@()) | ForEach-Object { $_.ToString('x2') }) -join '')
} finally {
  $sha.Dispose()
}

$pathAndQuery = '/v1/generated-reports/' + $SummaryId + '?clientId=' + $ClientId + '&currentYear=' + $CurrentYear

function New-SignedHeaders([string]$Method, [string]$Hash) {
  $timestamp = (([DateTimeOffset]::UtcNow).ToUnixTimeSeconds()).ToString()
  $nonce = [guid]::NewGuid().ToString()
  $requestId = [guid]::NewGuid().ToString()
  $canonical = @($Method.ToUpper(), $pathAndQuery, $timestamp, $nonce, $requestId, $Hash, $KeyId) -join "`n"
  $secretBytes = [Text.Encoding]::UTF8.GetBytes($Secret)
  $hmac = [System.Security.Cryptography.HMACSHA256]::new($secretBytes)
  try {
    $signatureBytes = $hmac.ComputeHash([Text.Encoding]::UTF8.GetBytes($canonical))
    $signature = [Convert]::ToBase64String($signatureBytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
  } finally {
    $hmac.Dispose()
  }
  return @{
    'X-PVS-Key-Id' = $KeyId
    'X-PVS-Timestamp' = $timestamp
    'X-PVS-Nonce' = $nonce
    'X-PVS-Request-Id' = $requestId
    'X-PVS-Content-SHA256' = $Hash
    'X-PVS-Signature' = $signature
  }
}

$uploadHeaders = New-SignedHeaders 'PUT' $bodyHash
$uploadHeaders['X-PVS-File-Name'] = [System.IO.Path]::GetFileName($resolvedPdfPath)
$upload = Invoke-RestMethod -Method Put -Uri ($BaseUrl.TrimEnd('/') + $pathAndQuery) -Headers $uploadHeaders -ContentType 'application/pdf' -Body $bytes -ErrorAction Stop
$upload | ConvertTo-Json -Depth 5

$downloadHeaders = New-SignedHeaders 'GET' $emptyHash
$resolvedOutputPath = [System.IO.Path]::GetFullPath($OutputPath)
Invoke-WebRequest -Method Get -Uri ($BaseUrl.TrimEnd('/') + $pathAndQuery) -Headers $downloadHeaders -OutFile $resolvedOutputPath -UseBasicParsing -ErrorAction Stop
Write-Host "Downloaded report to $resolvedOutputPath"
