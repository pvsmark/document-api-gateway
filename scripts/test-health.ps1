param([string]$BaseUrl = 'http://127.0.0.1:3100')

Write-Host 'Live health:'
Invoke-RestMethod -Uri "$BaseUrl/health/live" -Method Get

Write-Host 'Readiness health:'
Invoke-RestMethod -Uri "$BaseUrl/health/ready" -Method Get
