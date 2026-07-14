param(
  [Parameter(Mandatory = $true)][string]$Secret,
  [string]$Method = 'GET',
  [string]$PathAndQuery = '/health/live',
  [string]$KeyId = 'pvs-web2',
  [string]$Body = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$timestamp = (([DateTimeOffset]::UtcNow).ToUnixTimeSeconds()).ToString()
$nonce = [guid]::NewGuid().ToString()
$requestId = [guid]::NewGuid().ToString()

$sha = [System.Security.Cryptography.SHA256]::Create()
try {
  $bodyHash = (($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($Body)) | ForEach-Object { $_.ToString('x2') }) -join '')
} finally {
  $sha.Dispose()
}

$canonical = @($Method.ToUpper(), $PathAndQuery, $timestamp, $nonce, $requestId, $bodyHash, $KeyId) -join "`n"
$secretBytes = [Text.Encoding]::UTF8.GetBytes($Secret)
$hmac = [System.Security.Cryptography.HMACSHA256]::new($secretBytes)
try {
  $signatureBytes = $hmac.ComputeHash([Text.Encoding]::UTF8.GetBytes($canonical))
  $signature = [Convert]::ToBase64String($signatureBytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
} finally {
  $hmac.Dispose()
}

[pscustomobject]@{
  KeyId = $KeyId
  Timestamp = $timestamp
  Nonce = $nonce
  RequestId = $requestId
  ContentSha256 = $bodyHash
  Signature = $signature
}
