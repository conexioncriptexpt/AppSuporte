using System.IO;
using System.Net.Http;
using System.Net.Http.Json;
using System.Text.Json;
using SIPSorcery.Net;
using SIPSorceryMedia.Abstractions;
using SIPSorceryMedia.Encoders;
using SocketIOClient;

namespace CryptoConexPC;

public enum Phase { Idle, Connecting, Waiting, Active, Ended }

/// <summary>Assistance session: temporary device credentials, Socket.IO signalling and WebRTC screen stream.</summary>
public sealed class AssistClient : IDisposable
{
    private readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(15) };
    private SocketIOClient.SocketIO _socket;
    private string _token, _sessionId;
    private List<RTCIceServer> _ice = new();
    private RTCPeerConnection _pc;
    private VideoEncoderEndPoint _encoder;
    private ScreenCapture _capture;
    private CancellationTokenSource _cts;
    private readonly List<RTCIceCandidateInit> _pendingIce = new();

    public Phase Phase { get; private set; } = Phase.Idle;
    public string TechName { get; private set; }
    public bool Online { get; private set; } = true;
    public bool ControlAllowed { get; private set; }
    public bool Privacy { get; private set; }
    public string Message { get; private set; } = "";
    public event Action Changed;

    private void Notify() => Changed?.Invoke();

    private static string InstallId()
    {
        var dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "CryptoConex");
        Directory.CreateDirectory(dir);
        var file = Path.Combine(dir, "install_id");
        if (File.Exists(file)) return File.ReadAllText(file).Trim();
        var id = Guid.NewGuid().ToString();
        File.WriteAllText(file, id);
        return id;
    }

    private async Task RegisterAsync()
    {
        var body = new
        {
            install_id = InstallId(), platform = "windows", os = "Windows",
            os_version = Environment.OSVersion.Version.ToString(), name = Environment.MachineName,
        };
        var r = await _http.PostAsJsonAsync($"{Program.BackendUrl}/api/device/register", body);
        r.EnsureSuccessStatusCode();
        var j = await r.Content.ReadFromJsonAsync<JsonElement>();
        _token = j.GetProperty("device_token").GetString();
        var req = new HttpRequestMessage(HttpMethod.Get, $"{Program.BackendUrl}/api/ice-servers");
        req.Headers.Authorization = new("Bearer", _token);
        var ice = await (await _http.SendAsync(req)).Content.ReadFromJsonAsync<JsonElement>();
        _ice = ice.GetProperty("iceServers").EnumerateArray()
            .Where(s => !s.GetProperty("urls").GetString()!.StartsWith("turns:"))
            .Select(s => new RTCIceServer
            {
                urls = s.GetProperty("urls").GetString(),
                username = s.TryGetProperty("username", out var u) ? u.GetString() : null,
                credential = s.TryGetProperty("credential", out var c) ? c.GetString() : null,
                credentialType = RTCIceCredentialType.password,
            }).ToList();
    }

    public async Task StartAsync()
    {
        Phase = Phase.Connecting; Message = ""; Notify();
        _cts = new CancellationTokenSource();
        for (int attempt = 0; ; attempt++)
        {
            try { await RegisterAsync(); break; }
            catch
            {
                Online = false; Message = "Sem internet. A tentar de novo…"; Notify();
                await Task.Delay(Math.Min(30000, 1000 << Math.Min(attempt, 5)));
                if (Phase == Phase.Ended) return;
            }
        }
        _capture = new ScreenCapture();
        await ConnectSocketAsync();
    }

    private async Task ConnectSocketAsync()
    {
        _socket = new SocketIOClient.SocketIO(Program.BackendUrl, new SocketIOOptions
        {
            Path = "/api/socket.io",
            Auth = new Dictionary<string, string> { ["token"] = _token, ["kind"] = "device" },
            Reconnection = true, ReconnectionDelay = 1000, ReconnectionDelayMax = 15000, ReconnectionAttempts = int.MaxValue,
        });
        _socket.OnConnected += async (_, _) => { Online = true; Message = ""; Notify(); await RequestSupportAsync(); };
        _socket.OnDisconnected += (_, _) => { Online = false; Message = "Sem internet. A ligar de novo…"; Notify(); };
        _socket.On("support:assigned", r => { TechName = r.GetValue<JsonElement>(0).GetProperty("technician_name").GetString(); Notify(); });
        _socket.On("support:rejected", _ => { TechName = null; Notify(); });
        _socket.On("session:started", r => { Phase = Phase.Active; TechName = r.GetValue<JsonElement>(0).GetProperty("technician_name").GetString(); Notify(); });
        _socket.On("webrtc:request-offer", r => { _ = MakeOfferAsync(); });
        _socket.On("webrtc:answer", r => OnAnswer(r.GetValue<JsonElement>(0)));
        _socket.On("webrtc:ice-candidate", r => OnRemoteIce(r.GetValue<JsonElement>(0)));
        _socket.On("remote:command", r =>
        {
            if (!ControlAllowed || Phase != Phase.Active) return;
            InputController.Execute(r.GetValue<JsonElement>(0).GetProperty("command"));
        });
        _socket.On("privacy:enabled", _ => { Privacy = true; Notify(); });
        _socket.On("privacy:disabled", _ => { Privacy = false; Notify(); });
        _socket.On("privacy:request-disable", _ => { Message = "O técnico pede para desligares o modo de privacidade."; Notify(); });
        _socket.On("chat:message", r =>
        {
            var m = r.GetValue<JsonElement>(0);
            if (m.GetProperty("from").GetString() != "device") { Message = $"{m.GetProperty("author").GetString()}: {m.GetProperty("text").GetString()}"; Notify(); }
        });
        _socket.On("session:ended", _ => Stop(false));
        InputController.Blocked += msg => { Message = msg; Notify(); };
        await _socket.ConnectAsync();
    }

    private async Task RequestSupportAsync()
    {
        var res = $"{_capture.Width}x{_capture.Height}";
        await _socket.EmitAsync("support:request", ack => { _ = OnSupportAck(ack.GetValue<JsonElement>(0), res); }, new { consent_screen = true, screen = res, link_code = "" });
    }

    private async Task OnSupportAck(JsonElement j, string res)
    {
        {
            if (!j.GetProperty("ok").GetBoolean()) { Message = j.TryGetProperty("error", out var e) ? e.GetString() : ""; Notify(); return; }
            var s = j.GetProperty("session");
            _sessionId = s.GetProperty("id").GetString();
            Phase = s.GetProperty("status").GetString() == "active" ? Phase.Active : Phase.Waiting;
            var tn = s.GetProperty("technician_name");
            TechName = tn.ValueKind == JsonValueKind.String ? tn.GetString() : null;
            Notify();
            await _socket.EmitAsync("session:status", new { session_id = _sessionId, resolution = res });
            if (ControlAllowed) await SendConsentAsync(true);
        }
    }

    private async Task MakeOfferAsync()
    {
        _cts?.Cancel();
        _pc?.Close("renegotiate");
        _encoder?.Dispose();
        _cts = new CancellationTokenSource();
        lock (_pendingIce) _pendingIce.Clear();

        var pc = new RTCPeerConnection(new RTCConfiguration { iceServers = _ice, bundlePolicy = RTCBundlePolicy.max_bundle });
        var encoder = new VideoEncoderEndPoint();
        var track = new MediaStreamTrack(encoder.GetVideoSourceFormats(), MediaStreamStatusEnum.SendOnly);
        pc.addTrack(track);
        encoder.OnVideoSourceEncodedSample += pc.SendVideo;
        pc.OnVideoFormatsNegotiated += formats => encoder.SetVideoSourceFormat(formats.First());
        pc.onicecandidate += c =>
        {
            if (c == null) return;
            var cand = JsonSerializer.Deserialize<JsonElement>(c.toJSON());
            _ = _socket.EmitAsync("webrtc:ice-candidate", new { session_id = _sessionId, candidate = cand });
        };
        pc.onconnectionstatechange += st =>
        {
            _ = _socket.EmitAsync("session:status", new { session_id = _sessionId, connection_state = st.ToString() });
            if (st == RTCPeerConnectionState.connected) _ = PumpFramesAsync(encoder, _cts.Token);
        };
        _pc = pc; _encoder = encoder;
        var offer = pc.createOffer(null);
        await pc.setLocalDescription(offer);
        await _socket.EmitAsync("webrtc:offer", new { session_id = _sessionId, sdp = new { type = "offer", sdp = offer.sdp } });
    }

    private async Task PumpFramesAsync(VideoEncoderEndPoint encoder, CancellationToken ct)
    {
        const int fps = 15;
        var sw = System.Diagnostics.Stopwatch.StartNew();
        while (!ct.IsCancellationRequested)
        {
            var started = sw.ElapsedMilliseconds;
            try
            {
                var frame = _capture.Capture();
                encoder.ExternalVideoSourceRawSample(1000 / fps, _capture.Width, _capture.Height, frame, VideoPixelFormatsEnum.Bgra);
            }
            catch { /* transient capture error (e.g. secure desktop): keep going */ }
            var wait = 1000 / fps - (int)(sw.ElapsedMilliseconds - started);
            if (wait > 0) await Task.Delay(wait, ct).ContinueWith(_ => { });
        }
    }

    private void OnAnswer(JsonElement d)
    {
        var sdp = d.GetProperty("sdp").GetProperty("sdp").GetString();
        _pc?.setRemoteDescription(new RTCSessionDescriptionInit { type = RTCSdpType.answer, sdp = sdp });
        lock (_pendingIce) { foreach (var c in _pendingIce) _pc?.addIceCandidate(c); _pendingIce.Clear(); }
    }

    private void OnRemoteIce(JsonElement d)
    {
        var c = d.GetProperty("candidate");
        var init = new RTCIceCandidateInit
        {
            candidate = c.GetProperty("candidate").GetString(),
            sdpMid = c.TryGetProperty("sdpMid", out var mid) && mid.ValueKind == JsonValueKind.String ? mid.GetString() : "0",
            sdpMLineIndex = c.TryGetProperty("sdpMLineIndex", out var idx) && idx.ValueKind == JsonValueKind.Number ? (ushort)idx.GetInt32() : (ushort)0,
        };
        if (_pc?.remoteDescription == null) { lock (_pendingIce) _pendingIce.Add(init); }
        else _pc.addIceCandidate(init);
    }

    private Task SendConsentAsync(bool control) =>
        _sessionId == null ? Task.CompletedTask : _socket.EmitAsync("consent:update", new { session_id = _sessionId, control });

    public async Task SetControlAsync(bool allowed) { ControlAllowed = allowed; Notify(); await SendConsentAsync(allowed); }

    public async Task DisablePrivacyAsync()
    {
        Privacy = false; Notify();
        if (_socket != null) await _socket.EmitAsync("privacy:disable", new { session_id = _sessionId });
    }

    /// <summary>Ends the session and stops capture, stream and socket immediately.</summary>
    public void Stop(bool notify)
    {
        try
        {
            if (notify && _sessionId != null && _socket?.Connected == true)
                _socket.EmitAsync("session:end", new { session_id = _sessionId }).Wait(2000);
        }
        catch { }
        _cts?.Cancel();
        _pc?.Close("ended"); _pc = null;
        _encoder?.Dispose(); _encoder = null;
        _capture?.Dispose(); _capture = null;
        try { _socket?.DisconnectAsync().Wait(1000); } catch { }
        _socket?.Dispose(); _socket = null;
        _sessionId = null; Privacy = false; ControlAllowed = false; TechName = null;
        Phase = Phase.Ended;
        Notify();
    }

    public void Dispose() => Stop(true);
}
