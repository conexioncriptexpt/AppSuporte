using System.IO;

namespace CryptoConexPC;

/// <summary>Single simple window: logo, CONECTAR, status, touch permission and TERMINAR. Lives in the System Tray.</summary>
public sealed class MainForm : Form
{
    private static readonly Color Bg = Color.FromArgb(11, 15, 23), Lime = Color.FromArgb(132, 204, 22);
    private readonly AssistClient _client = new();
    private readonly Button _connect, _end;
    private readonly CheckBox _allow;
    private readonly Label _status;
    private readonly NotifyIcon _tray;
    private ActiveBar _bar;
    private PrivacyOverlay _overlay;
    private Phase _lastPhase = Phase.Idle;

    public MainForm()
    {
        Text = "APP DE SUPORTE TÉCNICO";
        Icon = new Icon(Path.Combine(AppContext.BaseDirectory, "app.ico"));
        BackColor = Bg; ForeColor = Color.White;
        ClientSize = new Size(520, 720);
        FormBorderStyle = FormBorderStyle.FixedSingle; MaximizeBox = false;
        StartPosition = FormStartPosition.CenterScreen;
        Font = new Font("Segoe UI", 12);

        using var logoStream = typeof(MainForm).Assembly.GetManifestResourceStream("CryptoConexPC.logo.png");
        var logo = new PictureBox { Image = logoStream != null ? Image.FromStream(logoStream) : null, SizeMode = PictureBoxSizeMode.Zoom, Size = new Size(200, 200), Location = new Point(160, 20) };
        var title = new Label { Text = "Bem-vindo ao APP DE SUPORTE TÉCNICO", Font = new Font("Segoe UI", 16, FontStyle.Bold), AutoSize = false, TextAlign = ContentAlignment.MiddleCenter, Bounds = new Rectangle(20, 230, 480, 40) };
        var sub = new Label { Text = "Vamos ajudar-te a resolver o teu problema", ForeColor = Color.Silver, AutoSize = false, TextAlign = ContentAlignment.MiddleCenter, Bounds = new Rectangle(20, 270, 480, 30) };
        _status = new Label { ForeColor = Lime, Font = new Font("Segoe UI", 14, FontStyle.Bold), AutoSize = false, TextAlign = ContentAlignment.MiddleCenter, Bounds = new Rectangle(20, 310, 480, 80) };
        _connect = new Button { Text = "CONECTAR", Font = new Font("Segoe UI", 26, FontStyle.Bold), BackColor = Lime, ForeColor = Bg, FlatStyle = FlatStyle.Flat, Bounds = new Rectangle(60, 400, 400, 110), AccessibleName = "Conectar ao técnico" };
        _connect.FlatAppearance.BorderSize = 0;
        _connect.Click += async (_, _) => await _client.StartAsync();
        _allow = new CheckBox { Text = "Permitir que o técnico use o rato e o teclado", Bounds = new Rectangle(60, 400, 420, 40), Visible = false };
        _allow.CheckedChanged += async (_, _) => { if (_allow.Checked != _client.ControlAllowed) await _client.SetControlAsync(_allow.Checked); };
        _end = new Button { Text = "TERMINAR", Font = new Font("Segoe UI", 20, FontStyle.Bold), BackColor = Color.FromArgb(220, 38, 38), ForeColor = Color.White, FlatStyle = FlatStyle.Flat, Bounds = new Rectangle(60, 460, 400, 90), Visible = false, AccessibleName = "Terminar assistência" };
        _end.Click += (_, _) => _client.Stop(true);
        var note = new Label { Text = "A tua privacidade é importante. A partilha do ecrã só começa depois da tua autorização.", ForeColor = Color.Gray, Font = new Font("Segoe UI", 10), AutoSize = false, TextAlign = ContentAlignment.MiddleCenter, Bounds = new Rectangle(20, 640, 480, 50) };
        Controls.AddRange(new Control[] { logo, title, sub, _status, _connect, _allow, _end, note });

        _tray = new NotifyIcon { Icon = Icon, Text = "Suporte Técnico", Visible = true };
        var menu = new ContextMenuStrip();
        menu.Items.Add("Abrir", null, (_, _) => { Show(); WindowState = FormWindowState.Normal; Activate(); });
        menu.Items.Add("Terminar assistência", null, (_, _) => _client.Stop(true));
        menu.Items.Add("Sair", null, (_, _) => { _client.Stop(true); _tray.Visible = false; Application.Exit(); });
        _tray.ContextMenuStrip = menu;
        _tray.DoubleClick += (_, _) => { Show(); Activate(); };

        _client.Changed += () => BeginInvoke(Render);
    }

    private void Render()
    {
        var p = _client.Phase;
        bool inSession = p is Phase.Connecting or Phase.Waiting or Phase.Active;
        _connect.Visible = !inSession;
        _end.Visible = _allow.Visible = inSession;
        if (_allow.Checked != _client.ControlAllowed) _allow.Checked = _client.ControlAllowed;
        var text = p switch
        {
            Phase.Connecting => "A ligar…",
            Phase.Waiting => _client.TechName != null ? $"Técnico {_client.TechName} a caminho…" : "A aguardar técnico…",
            Phase.Active => "Assistência ativa" + (_client.TechName != null ? $"\nTécnico: {_client.TechName}" : ""),
            Phase.Ended => "Assistência terminada",
            _ => "",
        };
        if (!_client.Online && inSession) text += "\nSem internet. A ligar de novo…";
        if (!string.IsNullOrEmpty(_client.Message)) text += "\n" + _client.Message;
        _status.Text = text;

        if (p != _lastPhase)
        {
            if (p == Phase.Active) _tray.ShowBalloonTip(4000, "Assistência remota ativa", "O técnico está a ver o teu ecrã.", ToolTipIcon.Info);
            if (p == Phase.Ended && _lastPhase != Phase.Idle) _tray.ShowBalloonTip(3000, "Assistência terminada", "A partilha do ecrã parou.", ToolTipIcon.Info);
            _lastPhase = p;
        }
        if (inSession && _bar == null) { _bar = new ActiveBar(() => _client.Stop(true), () => _ = _client.DisablePrivacyAsync()); _bar.Show(); }
        if (!inSession && _bar != null) { _bar.Close(); _bar = null; }
        if (_client.Privacy && _overlay == null && p == Phase.Active) { _overlay = new PrivacyOverlay(); _overlay.Show(); _bar?.BringToFront(); _bar?.Activate(); }
        if ((!_client.Privacy || !inSession) && _overlay != null) { _overlay.Close(); _overlay = null; }
        _bar?.SetPrivacy(_client.Privacy);
    }

    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        if (e.CloseReason == CloseReason.UserClosing && _client.Phase is Phase.Waiting or Phase.Active)
        {
            e.Cancel = true; Hide();
            _tray.ShowBalloonTip(3000, "Suporte Técnico", "A assistência continua. Usa o ícone junto ao relógio para terminar.", ToolTipIcon.Info);
            return;
        }
        _client.Stop(true);
        _tray.Visible = false;
        base.OnFormClosing(e);
    }
}
