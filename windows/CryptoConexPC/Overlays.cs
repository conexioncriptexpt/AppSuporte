using System.Runtime.InteropServices;

namespace CryptoConexPC;

internal static class Native
{
    [DllImport("user32.dll")] public static extern bool SetWindowDisplayAffinity(nint hWnd, uint affinity);
    public const uint WDA_EXCLUDEFROMCAPTURE = 0x11;
    public const int WS_EX_LAYERED = 0x80000, WS_EX_TRANSPARENT = 0x20, WS_EX_TOOLWINDOW = 0x80, WS_EX_NOACTIVATE = 0x08000000;

    /// <summary>Hides a window from screen capture (Windows 10 2004+), so the technician's view stays clear.</summary>
    public static void ExcludeFromCapture(Form f) => SetWindowDisplayAffinity(f.Handle, WDA_EXCLUDEFROMCAPTURE);
}

/// <summary>Always-visible bar telling the user that remote assistance is active, with TERMINAR.</summary>
public sealed class ActiveBar : Form
{
    private readonly Label _label;
    private readonly Button _privacyOff;

    public ActiveBar(Action terminate, Action disablePrivacy)
    {
        FormBorderStyle = FormBorderStyle.None;
        TopMost = true;
        ShowInTaskbar = false;
        StartPosition = FormStartPosition.Manual;
        BackColor = Color.FromArgb(11, 15, 23);
        var screen = Screen.PrimaryScreen!.WorkingArea;
        Size = new Size(560, 48);
        Location = new Point(screen.Left + (screen.Width - Width) / 2, screen.Top);
        _label = new Label { Text = "●  Assistência remota ativa", ForeColor = Color.FromArgb(132, 204, 22), Font = new Font("Segoe UI", 11, FontStyle.Bold), AutoSize = false, Dock = DockStyle.Fill, TextAlign = ContentAlignment.MiddleLeft, Padding = new Padding(12, 0, 0, 0) };
        var end = new Button { Text = "TERMINAR", Dock = DockStyle.Right, Width = 120, BackColor = Color.FromArgb(220, 38, 38), ForeColor = Color.White, FlatStyle = FlatStyle.Flat, Font = new Font("Segoe UI", 10, FontStyle.Bold) };
        end.Click += (_, _) => terminate();
        _privacyOff = new Button { Text = "Desligar privacidade", Dock = DockStyle.Right, Width = 160, ForeColor = Color.White, FlatStyle = FlatStyle.Flat, Visible = false };
        _privacyOff.Click += (_, _) => disablePrivacy();
        Controls.Add(_label);
        Controls.Add(_privacyOff);
        Controls.Add(end);
    }

    public void SetPrivacy(bool on) => _privacyOff.Visible = on;

    protected override CreateParams CreateParams
    {
        get { var cp = base.CreateParams; cp.ExStyle |= Native.WS_EX_TOOLWINDOW; return cp; }
    }

    protected override void OnHandleCreated(EventArgs e) { base.OnHandleCreated(e); Native.ExcludeFromCapture(this); }
}

/// <summary>Dark privacy screen shown to the client. Excluded from capture and click-through, so the technician keeps working.</summary>
public sealed class PrivacyOverlay : Form
{
    public PrivacyOverlay()
    {
        FormBorderStyle = FormBorderStyle.None;
        TopMost = true;
        ShowInTaskbar = false;
        StartPosition = FormStartPosition.Manual;
        Bounds = Screen.PrimaryScreen!.Bounds;
        BackColor = Color.Black;
        Controls.Add(new Label
        {
            Text = "Ajuste Técnico — Aguarde...\n\nModo de privacidade ativo. Pode desligá-lo ou terminar na barra superior.",
            ForeColor = Color.White, Font = new Font("Segoe UI", 28, FontStyle.Bold), Dock = DockStyle.Fill, TextAlign = ContentAlignment.MiddleCenter,
        });
    }

    protected override CreateParams CreateParams
    {
        get { var cp = base.CreateParams; cp.ExStyle |= Native.WS_EX_LAYERED | Native.WS_EX_TRANSPARENT | Native.WS_EX_TOOLWINDOW | Native.WS_EX_NOACTIVATE; return cp; }
    }

    protected override bool ShowWithoutActivation => true;

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        Opacity = 0.97;
        Native.ExcludeFromCapture(this);
    }
}
