param(
  [Parameter(Mandatory = $true)][string]$Secret,
  [Parameter(Mandatory = $true)][int]$ClientId,
  [Parameter(Mandatory = $true)][int]$DocumentId,
  [string]$BaseUrl = 'http://127.0.0.1:3100',
  [string]$KeyId = 'pvs-web2',
  [string]$OutputPath = '.\document-download.bin'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$pathAndQuery = "/v1/documents/${