param(
  [Parameter(Mandatory=$true)][string]$Secret,
  [string]$Method = 'GET',
  [string]$PathAndQuery = '/health/live',
  [string]$KeyId = 'pvs-web2',
  [string]$Body = ''
)

$timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds().ToString()
$nonce = [guid]::NewGuid().ToString()
$requestId = [guid]::NewGuid().ToString()
$sha = [System.Security.Cryptography.SHA256]::Create()
$bodyHash = (($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($Body)) | ForEach-Object { $_.ToString('x2') }) -join '')
$canonical = @($Method.ToUpper(), $PathAndQuery, $timestamp, $nonce, $requestId, $bodyHash, $KeyId) -join "`n"
$hmac = New-Object System.Security.Cryptography.HMACSHA256([Text.Encoding]::UTF8.GetBytes($Secret))
$signature = [Convert]::ToBase64String($hmac.ComputeHash([Text.Encoding]::UTF8.GetBytes($canonical))).TrimEnd('=').Replace('+','-').Replace('/','_')

[pscustomobject]@{
  KeyId = $KeyId
  Timestamp = $timestamp
  Nonce = $nonce
  RequestId = $requestId
  ContentSha256 = $bodyHash
  Signature = $signature
}
