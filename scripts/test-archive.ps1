param(
  [Parameter(Mandatory=$true)][string]$Secret,
  [Parameter(Mandatory=$true)][int]$ClientId,
  [Parameter(Mandatory=$true)][int[]]$DocumentIds,
  [string]$BaseUrl = 'http://127.0.0.1:3100',
  [string]$KeyId = 'pvs-web2',
  [string]$OutputPath = '.\documents.zip'
)

$pathAndQuery = '/v1/document-archives/selected'
$body = @{ clientId = $ClientId; documentIds = $DocumentIds; archiveName = 'documents' } | ConvertTo-Json -Compress
$signature = & "$PSScriptRoot\generate-signature.ps1" -Secret $Secret -Method POST -PathAndQuery $pathAndQuery -KeyId $KeyId -Body $body
$headers = @{
  'X-PVS-Key-Id' = $signature.KeyId
  'X-PVS-Timestamp' = $signature.Timestamp
  'X-PVS-Nonce' = $signature.Nonce
  'X-PVS-Request-Id' = $signature.RequestId
  'X-PVS-Content-SHA256' = $signature.ContentSha256
  'X-PVS-Signature' = $signature.Signature
}
Invoke-WebRequest -Uri ($BaseUrl.TrimEnd('/') + $pathAndQuery) -Method Post -Headers $headers -ContentType 'application/json' -Body $body -OutFile $OutputPath
Write-Host "Archive saved to $OutputPath"
