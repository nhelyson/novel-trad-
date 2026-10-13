Add-Type -ReferencedAssemblies 'System.Windows.Forms.dll' @'
using System;
using System.Windows.Forms;
using System.Runtime.InteropServices;

public class NativePicker {
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);
}

public class WindowWrapper : IWin32Window {
    private IntPtr _hwnd;
    public WindowWrapper(IntPtr handle) { _hwnd = handle; }
    public IntPtr Handle { get { return _hwnd; } }
}
'@

$hwnd = [NativePicker]::GetForegroundWindow()
$owner = $null
$topForm = $null
if ($hwnd -ne [IntPtr]::Zero) {
    $owner = New-Object WindowWrapper($hwnd)
    [NativePicker]::SetForegroundWindow($hwnd)
} else {
    $topForm = New-Object System.Windows.Forms.Form
    $topForm.TopMost = $true
    $topForm.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen
    $topForm.ShowInTaskbar = $false
    $topForm.Opacity = 0
    $topForm.Show()
    [NativePicker]::SetForegroundWindow($topForm.Handle)
    $owner = $topForm
}

$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = "Sélectionnez votre dossier de romans / mangas (Lecture Zéro Copie)"
$dialog.ShowNewFolderButton = $true

$result = $dialog.ShowDialog($owner)

if ($topForm -ne $null) {
    $topForm.Close()
    $topForm.Dispose()
}

if ($result -eq [System.Windows.Forms.DialogResult]::OK -and $dialog.SelectedPath) {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    [Console]::WriteLine($dialog.SelectedPath)
}
