# Fixed Windows UI Automation adapter for WiskBot.
# Reads one JSON request per line from stdin, writes one JSON response per line to stdout.
# No model input is ever used as a command, script, path or shell argument.

$ErrorActionPreference = 'Stop'
$null = Add-Type -AssemblyName UIAutomationClient
$null = Add-Type -AssemblyName UIAutomationTypes
$null = Add-Type -AssemblyName System.Drawing
$null = Add-Type -AssemblyName System.Windows.Forms

$null = Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class WiskbotMouse {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, IntPtr extra);
}
'@

$script:MaxDepth = 5
$script:MaxNodes = 120
$script:MaxTextBytes = 32768

function Write-Response {
  param([Parameter(Mandatory = $true)] [object] $Payload)
  $json = $Payload | ConvertTo-Json -Depth 8 -Compress
  [Console]::Out.WriteLine($json)
  [Console]::Out.Flush()
}

function Convert-ToSafeInt {
  param($Value)
  try {
    $number = [double]$Value
    if ([double]::IsNaN($number) -or [double]::IsInfinity($number)) { return 0 }
    return [int][Math]::Round($number)
  } catch {
    return 0
  }
}

function Get-Rect {
  param([Parameter(Mandatory = $true)] $Element)
  $r = $Element.Current.BoundingRectangle
  return @{
    x = Convert-ToSafeInt -Value $r.X
    y = Convert-ToSafeInt -Value $r.Y
    width = [Math]::Max(0, (Convert-ToSafeInt -Value $r.Width))
    height = [Math]::Max(0, (Convert-ToSafeInt -Value $r.Height))
  }
}

function Get-WindowByTitle {
  param([Parameter(Mandatory = $true)] [string] $Title)
  $condition = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::NameProperty, $Title)
  $window = [System.Windows.Automation.AutomationElement]::RootElement.FindFirst(
    [System.Windows.Automation.TreeScope]::Children, $condition)
  if ($null -eq $window) { throw "Window not found: $Title" }
  return $window
}

function Test-IsSecretControl {
  param([Parameter(Mandatory = $true)] $Element)
  try {
    $isPassword = $Element.GetCurrentPropertyValue(
      [System.Windows.Automation.AutomationElement]::IsPasswordProperty)
    if ($isPassword -eq $true) { return $true }
  } catch { }
  $controlType = [string]$Element.Current.ControlType.ProgrammaticName
  $label = "$($Element.Current.Name) $($Element.Current.AutomationId)"
  if ($controlType -match 'Password') { return $true }
  if ($label -match '(?i)password|passphrase|secret|token|api[-_ ]?key|cvv|card.?number|\botp\b|\bpin\b') {
    return $true
  }
  return $false
}

function Get-ElementBySelector {
  param(
    [Parameter(Mandatory = $true)] $Window,
    [Parameter(Mandatory = $true)] [string] $Selector
  )
  if ($Selector -match '^id=(.+)$') {
    $value = $Matches[1]
    $condition = New-Object System.Windows.Automation.PropertyCondition(
      [System.Windows.Automation.AutomationElement]::AutomationIdProperty, $value)
  } elseif ($Selector -match '^name=(.+)$') {
    $value = $Matches[1]
    $condition = New-Object System.Windows.Automation.PropertyCondition(
      [System.Windows.Automation.AutomationElement]::NameProperty, $value)
  } else {
    $condition = New-Object System.Windows.Automation.PropertyCondition(
      [System.Windows.Automation.AutomationElement]::NameProperty, $Selector)
  }
  $element = $Window.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $condition)
  if ($null -eq $element) { throw "Element not found: $Selector" }
  return $element
}

function Get-TreeSnapshot {
  param(
    [Parameter(Mandatory = $true)] $Window,
    [int] $Depth = 5,
    [int] $Nodes = 120
  )
  $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
  $queue = New-Object System.Collections.ArrayList
  $null = $queue.Add(@{ Element = $Window; Level = 0 })
  $result = New-Object System.Collections.ArrayList
  $truncated = $false

  while ($queue.Count -gt 0 -and $result.Count -lt $Nodes) {
    $item = $queue[0]
    $queue.RemoveAt(0)
    $element = $item.Element
    $level = [int]$item.Level
    $secret = Test-IsSecretControl -Element $element
    $patterns = @()
    try { $null = $element.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern); $patterns += 'invoke' } catch { }
    try { $null = $element.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern); $patterns += 'value' } catch { }
    try { $null = $element.GetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern); $patterns += 'text' } catch { }

    $null = $result.Add(@{
      level       = $level
      name        = [string]$element.Current.Name
      automationId = [string]$element.Current.AutomationId
      controlType = [string]$element.Current.ControlType.ProgrammaticName
      isSecret    = $secret
      rect        = Get-Rect -Element $element
      patterns    = $patterns
    })

    if ($level -lt $Depth) {
      $child = $walker.GetFirstChild($element)
      while ($null -ne $child -and $result.Count + $queue.Count -lt $Nodes) {
        $null = $queue.Add(@{ Element = $child; Level = ($level + 1) })
        $child = $walker.GetNextSibling($child)
      }
      if ($null -ne $child) { $truncated = $true }
    }
  }
  if ($queue.Count -gt 0) { $truncated = $true }

  return @{ nodes = $result.ToArray(); truncated = $truncated; untrustedDesktopData = $true }
}

function Show-Highlight {
  param([Parameter(Mandatory = $true)] $Rect)
  try {
    $form = New-Object System.Windows.Forms.Form
    $form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
    $form.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual
    $form.Location = New-Object System.Drawing.Point([int]$Rect.x, [int]$Rect.y)
    $form.Size = New-Object System.Drawing.Size(
      [Math]::Max(4, [int]$Rect.width), [Math]::Max(4, [int]$Rect.height))
    $form.BackColor = [System.Drawing.Color]::Lime
    $form.Opacity = 0.20
    $form.TopMost = $true
    $form.Show()
    $form.Refresh()
    Start-Sleep -Milliseconds 600
    $form.Close()
    $form.Dispose()
  } catch { }
}

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  $requestId = 'unknown'
  try {
    $request = $line | ConvertFrom-Json
    $requestId = [string]$request.requestId
    if ($script:MaxDepth -ne $request.maxDepth -and $null -ne $request.maxDepth) {
      $script:MaxDepth = [Math]::Min(5, [int]$request.maxDepth)
    }
    if ($null -ne $request.maxNodes) {
      $script:MaxNodes = [Math]::Min(120, [int]$request.maxNodes)
    }

    switch ($request.type) {
      'listWindows' {
        $condition = [System.Windows.Automation.Condition]::TrueCondition
        $windows = [System.Windows.Automation.AutomationElement]::RootElement.FindAll(
          [System.Windows.Automation.TreeScope]::Children, $condition)
        $items = @()
        foreach ($window in $windows) {
          if ($items.Count -ge 50) { break }
          $items += @{
            title = [string]$window.Current.Name
            className = [string]$window.Current.ClassName
            rect = Get-Rect -Element $window
          }
        }
        Write-Response @{ type = 'result'; requestId = $requestId; ok = $true; data = @{ windows = $items } }
      }
      'tree' {
        $window = Get-WindowByTitle -Title ([string]$request.title)
        $data = Get-TreeSnapshot -Window $window -Depth $script:MaxDepth -Nodes $script:MaxNodes
        Write-Response @{ type = 'result'; requestId = $requestId; ok = $true; data = $data }
      }
      'activate' {
        $window = Get-WindowByTitle -Title ([string]$request.title)
        Show-Highlight -Rect (Get-Rect -Element $window)
        $window.SetFocus()
        Write-Response @{ type = 'result'; requestId = $requestId; ok = $true; data = @{ activated = $true } }
      }
      'invoke' {
        $window = Get-WindowByTitle -Title ([string]$request.title)
        $element = Get-ElementBySelector -Window $window -Selector ([string]$request.selector)
        if (Test-IsSecretControl -Element $element) { throw 'Refusing to invoke a password or secret control.' }
        $rect = Get-Rect -Element $element
        Show-Highlight -Rect $rect
        $pattern = $element.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
        $pattern.Invoke()
        Write-Response @{ type = 'result'; requestId = $requestId; ok = $true; data = @{ invoked = $true; name = [string]$element.Current.Name } }
      }
      'clickPoint' {
        $window = Get-WindowByTitle -Title ([string]$request.title)
        $windowRect = Get-Rect -Element $window
        $x = [int]$request.x; $y = [int]$request.y
        if ($x -lt [int]$windowRect.x -or $y -lt [int]$windowRect.y -or
            $x -gt ([int]$windowRect.x + [int]$windowRect.width) -or
            $y -gt ([int]$windowRect.y + [int]$windowRect.height)) {
          throw 'Click point is outside the allowlisted window.'
        }
        Show-Highlight -Rect @{ x = ($x - 8); y = ($y - 8); width = 16; height = 16 }
        $null = [WiskbotMouse]::SetCursorPos($x, $y)
        [WiskbotMouse]::mouse_event(0x0002, 0, 0, 0, [IntPtr]::Zero)
        [WiskbotMouse]::mouse_event(0x0004, 0, 0, 0, [IntPtr]::Zero)
        Write-Response @{ type = 'result'; requestId = $requestId; ok = $true; data = @{ clicked = $true; x = $x; y = $y } }
      }
      'type' {
        $window = Get-WindowByTitle -Title ([string]$request.title)
        $element = Get-ElementBySelector -Window $window -Selector ([string]$request.selector)
        if (Test-IsSecretControl -Element $element) { throw 'Refusing to type into a password or secret control.' }
        $pattern = $element.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
        $pattern.SetValue([string]$request.value)
        Write-Response @{ type = 'result'; requestId = $requestId; ok = $true; data = @{ filled = $true } }
      }
      'readText' {
        $window = Get-WindowByTitle -Title ([string]$request.title)
        $element = Get-ElementBySelector -Window $window -Selector ([string]$request.selector)
        if (Test-IsSecretControl -Element $element) { throw 'Refusing to read a password or secret control.' }
        $pattern = $element.GetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern)
        $text = [string]$pattern.DocumentRange.GetText(-1)
        $truncated = [Text.Encoding]::UTF8.GetByteCount($text) -gt $script:MaxTextBytes
        $text = $text.Substring(0, [Math]::Min($text.Length, $script:MaxTextBytes))
        Write-Response @{ type = 'result'; requestId = $requestId; ok = $true; data = @{ untrustedDesktopData = $true; text = $text; truncated = $truncated } }
      }
      'screenshot' {
        $window = Get-WindowByTitle -Title ([string]$request.title)
        $rect = Get-Rect -Element $window
        $width = [Math]::Min([Math]::Max(1, [int]$rect.width), 1920)
        $height = [Math]::Min([Math]::Max(1, [int]$rect.height), 1080)
        $bitmap = New-Object System.Drawing.Bitmap($width, $height)
        $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
        $size = New-Object System.Drawing.Size($width, $height)
        $graphics.CopyFromScreen([int]$rect.x, [int]$rect.y, 0, 0, $size)
        $bitmap.Save([string]$request.path, [System.Drawing.Imaging.ImageFormat]::Png)
        $graphics.Dispose()
        $bitmap.Dispose()
        Write-Response @{ type = 'result'; requestId = $requestId; ok = $true; data = @{ path = [string]$request.path; bytes = (Get-Item -LiteralPath ([string]$request.path)).Length } }
      }
      default {
        throw "Unknown operation: $($request.type)"
      }
    }
  } catch {
    Write-Response @{ type = 'result'; requestId = $requestId; ok = $false; error = $_.Exception.Message }
  }
}
