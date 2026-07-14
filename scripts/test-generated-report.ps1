param(
  [Parameter(Mandatory=$true)][string]$BaseUrl,
  [Parameter(Mandatory=$true)][string]$Secret,
  [Parameter(Mandatory=$true)][string]$PdfPath,
  [Parameter(Mandatory=$true)][string]$SummaryId,
  [Parameter(Mandatory=$true)][int]$ClientId,
  [Parameter(Mandatory=$true)][int]$CurrentYear,
  [string]$KeyId = 'pvs-web2',
  [string]$OutputPath = '.\downloaded-summary.pdf'
)

$bytes = [System.IO.File]::ReadAllBytes((Resolve-Path $PdfPath))
$sha = [System.Security.Cryptography.SHA256]::Create()
$bodyHash = (($sha.ComputeHash($bytes) | ForEach-Object { $_.ToString('x2') }) -join '')
$pathAndQuery = "/v1/generated-reports/$SummaryId?clientId=$ClientId&currentYear=$CurrentYear"

function New-SignedHeaders([string]$Method, [string]$Hash) {
  $timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds().ToString()
  $nonce = [guid]::NewGuid().ToString()
  $requestId = [guid]::NewGuid().ToString()
  $canonical = @($Method.ToUpper(), $pathAndQuery, $timestamp, $nonce, $requestId, $Hash, $KeyId) -join "`n"
  $hmac = New-Object System.Security.Cryptography.HMACSHA256([Text.Encoding]::UTF8.GetBytes($Secret))
  $signature = [Convert]::ToBase64String($hmac.ComputeHash([Text.Encoding]::UTF8.GetBytes($canonical))).TrimEnd('=').Replace('+','-').Replace('/','_')
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
$uploadHeaders['X-PVS-File-Name'] = [System.IO.Path]::GetFileName($PdfPath)
$upload = Invoke-RestMethod -Method Put -Uri ($BaseUrl.TrimEnd('/') + $pathAndQuery) -Headers $uploadHeaders -ContentType 'application/pdf' -Body $bytes
$upload | ConvertTo-Json -Depth 5

$emptyHash = (($sha.ComputeHash([byte[]]@()) | ForEach-Object { $_.ToString('x2') }) -join '')
$downloadHeaders = New-SignedHeaders 'GET' $emptyHash
Invoke-WebRequest -Method Get -Uri ($BaseUrl.TrimEnd('/') + $pathAndQuery) -Headers $downloadHeaders -OutFile $OutputPath
Write-Host "Downloaded report to $OutputPath"