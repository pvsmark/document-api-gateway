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

$pathAndQuery = "/v1/documents/${DocumentId}?clientId=$ClientId"
$timestamp = [DateTimeOffset]::Utc