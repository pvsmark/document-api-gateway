param(
  [Parameter(Mandatory=$true)][string]$Secret,
  [Parameter(Mandatory=$true)][int]$ClientId,
  [Parameter(Mandatory=$true)][int]$DocumentId,
  [string]$BaseUrl = 'https://pvs-document-api.internal',
  [string]$KeyId = 'pvs-web2',
  [string]$OutputPath = '.\document-download.bin'
)

$pathAndQuery = "/v1/documents/$DocumentId?clientId=$ClientId"
$timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds().ToString()
$nonce = [guid]::NewGuid().ToString()
$requestId = [guid]::NewGuid().ToString()
$sha = [System.Security.Cryptography.SHA256]::Create()
$emptyBytes = New-Object byte[] 0
$bodyHash = (($sha.ComputeHash($emptyBytes) | ForEach-Object { $_.ToString('x2') }) -join '')
$canonical = @('GET', $pathAndQuery, $timestamp, $nonce, $requestId, $bodyHash, $KeyId) -join "`n"
$hmac = New-Object System.Security.Cryptography.HMACSHA256([Text.Encoding]::UTF8.GetBytes($Secret))
$signature = [Convert]::ToBase64String($hmac.ComputeHash([Text.Encoding]::UTF8.GetBytes($canonical))).TrimEnd('=').Replace('+','-').Replace('/','_')

$headers = @{
  'X-PVS-Key-Id' = $KeyId
  'X-PVS-Timestamp' = $timestamp
  'X-PVS-Nonce' = $nonce
  'X-PVS-Request-Id' = $requestId
  'X-PVS-Content-SHA256' = $bodyHash
  'X-PVS-Signature' = $signature
}

Invoke-WebRequest -Uri ($BaseUrl.TrimEnd('/') + $pathAndQuery) -Method Get -Headers $headers -OutFile $OutputPath -UseBasicParsing
Write-Host "Document saved to $OutputPath"
Write-Host "Request ID: $requestId"
