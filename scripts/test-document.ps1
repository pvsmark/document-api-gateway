param(
  [Parameter(Mandatory=$true)][string]$Secret,
  [Parameter(Mandatory=$true)][int]$ClientId,
  [Parameter(Mandatory=$true)][int]$DocumentId,
  [string]$BaseUrl = 'https://pvs-document-api.internal',
  [string]$KeyId = 'pvs-web2',
  [string]$OutputPath = '.\document-download.bin'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$pathAndQuery = "/v1/documents/$DocumentId?clientId=$ClientId"
$timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds().ToString()
$nonce = [guid]::NewGuid().ToString()
$requestId = [guid]::NewGuid().ToString()

$sha = [System.Security.Cryptography.SHA256]::Create()
try {
  $emptyBytes = New-Object byte[] 0
  $bodyHash = (($sha.ComputeHash($emptyBytes) | ForEach-Object { $_.ToString('x2') }) -join '')
} finally {
  $sha.Dispose()
}

$canonical = @('GET', $pathAndQuery, $timestamp, $nonce, $requestId, $bodyHash, $KeyId) -join "`n"
$secretBytes = [Text.Encoding]::UTF8.GetBytes($Secret)
$hmac = [System.Security.Cryptography.HMACSHA256]::new($secretBytes)
try {
  $signatureBytes = $hmac.ComputeHash([Text.Encoding]::UTF8.GetBytes($canonical))
  $signature = [Convert]::ToBase64String($signatureBytes).TrimEnd('=').Replace('+','-').Replace('/','_')
} finally {
  $hmac.Dispose()
}

$headers = @{
  'X-PVS-Key-Id' = $KeyId
  'X-PVS-Timestamp' = $timestamp
  'X-PVS-Nonce' = $nonce
  'X-PVS-Request-Id' = $requestId
  'X-PVS-Content-SHA256' = $bodyHash
  'X-PVS-Signature' = $signature
}

Invoke-WebRequest -Uri ($BaseUrl.TrimEnd('/') + $pathAndQuery) -Method Get -Headers $headers -OutFile $OutputPath -UseBasicParsing -ErrorAction Stop
Write-Host "Document saved to $OutputPath"
Write-Host "Request ID: $requestId"
