#requires -version 5.1
Add-Type -Language CSharp -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class RawPrinterHelper {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
  public class DOCINFOA {
    [MarshalAs(UnmanagedType.LPStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPStr)] public string pDataType;
  }
  [DllImport("winspool.Drv", EntryPoint="OpenPrinterA", SetLastError=true, CharSet=CharSet.Ansi, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool OpenPrinter(string szPrinter, out IntPtr hPrinter, IntPtr pd);
  [DllImport("winspool.Drv", EntryPoint="ClosePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool ClosePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint="StartDocPrinterA", SetLastError=true, CharSet=CharSet.Ansi, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool StartDocPrinter(IntPtr hPrinter, int level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOA di);
  [DllImport("winspool.Drv", EntryPoint="EndDocPrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool EndDocPrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint="StartPagePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool StartPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint="EndPagePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool EndPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint="WritePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, int dwCount, out int dwWritten);
}
"@

function Send-ZPL {
  param(
    [string]$PrinterName,
    [string]$ZplText
  )
  if (-not $PrinterName) {
    $PrinterName = (Get-CimInstance Win32_Printer | Where-Object Default -eq $true | Select-Object -First 1 -ExpandProperty Name)
  }
  if (-not $PrinterName) { throw "Aucune imprimante par défaut" }
  $h = [IntPtr]::Zero
  if (-not ([RawPrinterHelper]::OpenPrinter($PrinterName, [ref]$h, [IntPtr]::Zero))) { throw "OpenPrinter échoué: $PrinterName" }
  try {
    $di = New-Object RawPrinterHelper+DOCINFOA
    $di.pDocName = "ZPL Job"
    $di.pDataType = "RAW"
    if (-not [RawPrinterHelper]::StartDocPrinter($h, 1, $di)) { throw "StartDocPrinter échoué" }
    try {
      if (-not [RawPrinterHelper]::StartPagePrinter($h)) { throw "StartPagePrinter échoué" }
      try {
        $bytes = [Text.Encoding]::ASCII.GetBytes($ZplText)
        $ptr = [Runtime.InteropServices.Marshal]::AllocHGlobal($bytes.Length)
        try {
          [Runtime.InteropServices.Marshal]::Copy($bytes, 0, $ptr, $bytes.Length)
          $written = 0
          if (-not [RawPrinterHelper]::WritePrinter($h, $ptr, $bytes.Length, [ref]$written)) { throw "WritePrinter échoué" }
        } finally { [Runtime.InteropServices.Marshal]::FreeHGlobal($ptr) }
      } finally { [RawPrinterHelper]::EndPagePrinter($h) | Out-Null }
    } finally { [RawPrinterHelper]::EndDocPrinter($h) | Out-Null }
  } finally { [RawPrinterHelper]::ClosePrinter($h) | Out-Null }
}

$listener = New-Object System.Net.HttpListener
$prefix = 'http://localhost:9110/'
$listener.Prefixes.Add($prefix)
try { $listener.Start() } catch { Write-Error "Impossible de démarrer le serveur sur $prefix. Lancez PowerShell en tant qu'administrateur."; exit 1 }
Write-Host "Zebra Local Agent en écoute sur $prefix"
while ($true) {
  $ctx = $listener.GetContext()
  try {
    $req = $ctx.Request
    $res = $ctx.Response
    # CORS headers
    $res.Headers.Add('Access-Control-Allow-Origin','*') | Out-Null
    $res.Headers.Add('Vary','Origin') | Out-Null
    if ($req.HttpMethod -eq 'OPTIONS') {
      $res.Headers.Add('Access-Control-Allow-Methods','POST, GET, OPTIONS') | Out-Null
      $res.Headers.Add('Access-Control-Allow-Headers','content-type') | Out-Null
      $res.Headers.Add('Access-Control-Max-Age','86400') | Out-Null
      $res.StatusCode = 204
      $res.OutputStream.Close()
      continue
    }
    if ($req.HttpMethod -eq 'GET' -and $req.Url.AbsolutePath -eq '/health') {
      $buf = [Text.Encoding]::UTF8.GetBytes('{"status":"ok"}')
      $res.ContentType = 'application/json'
      $res.OutputStream.Write($buf,0,$buf.Length)
      $res.OutputStream.Close()
      continue
    }
    if ($req.HttpMethod -eq 'GET' -and $req.Url.AbsolutePath -eq '/printers') {
      try {
        $list = Get-CimInstance Win32_Printer | Select-Object Name, DriverName, Default
        $payload = @{ default = ($list | Where-Object Default -eq $true | Select-Object -First 1 -ExpandProperty Name); printers = @() }
        foreach ($p in $list) { $payload.printers += @{ name = $p.Name; driver = $p.DriverName; default = [bool]$p.Default } }
        $json = $payload | ConvertTo-Json -Depth 4
        $bytes = [Text.Encoding]::UTF8.GetBytes($json)
        $res.ContentType = 'application/json'
        $res.OutputStream.Write($bytes,0,$bytes.Length)
      } catch {
        $msg = $_.Exception.Message.Replace('"','\"')
        $bytes = [Text.Encoding]::UTF8.GetBytes('{"error":"enum_failed","message":"'+$msg+'"}')
        $res.StatusCode = 500
        $res.OutputStream.Write($bytes,0,$bytes.Length)
      }
      $res.OutputStream.Close()
      continue
    }
    if ($req.HttpMethod -eq 'POST' -and $req.Url.AbsolutePath -eq '/print') {
      $reader = New-Object IO.StreamReader($req.InputStream, [Text.Encoding]::UTF8)
      $body = $reader.ReadToEnd()
      $reader.Close()
      try {
        $obj = $null
        if ($body) { $obj = $body | ConvertFrom-Json }
        $printer = $obj.printer
        $zpl = $obj.zpl
        if (-not $zpl) { throw "Champ zpl manquant" }
        Send-ZPL -PrinterName $printer -ZplText $zpl
        $payload = '{"ok":true}'
        $bytes = [Text.Encoding]::UTF8.GetBytes($payload)
        $res.ContentType = 'application/json'
        $res.OutputStream.Write($bytes,0,$bytes.Length)
        $res.OutputStream.Close()
      } catch {
        $msg = $_.Exception.Message.Replace('"','\"')
        $payload = '{"error":"print_failed","message":"'+$msg+'"}'
        $bytes = [Text.Encoding]::UTF8.GetBytes($payload)
        $res.StatusCode = 500
        $res.ContentType = 'application/json'
        $res.OutputStream.Write($bytes,0,$bytes.Length)
        $res.OutputStream.Close()
      }
      continue
    }
    $res.StatusCode = 404
    $res.OutputStream.Close()
  } catch {}
}
