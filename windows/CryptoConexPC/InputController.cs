using System.Runtime.InteropServices;
using System.Text.Json;
using System.Windows.Automation;

namespace CryptoConexPC;

/// <summary>Authorised mouse/keyboard assistance through user32.dll (SendInput). Never runs without client consent.</summary>
public static class InputController
{
    [StructLayout(LayoutKind.Sequential)]
    private struct INPUT { public uint type; public InputUnion u; }

    [StructLayout(LayoutKind.Explicit)]
    private struct InputUnion
    {
        [FieldOffset(0)] public MOUSEINPUT mi;
        [FieldOffset(0)] public KEYBDINPUT ki;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MOUSEINPUT { public int dx, dy; public int mouseData; public uint dwFlags, time; public nint dwExtraInfo; }

    [StructLayout(LayoutKind.Sequential)]
    private struct KEYBDINPUT { public ushort wVk, wScan; public uint dwFlags, time; public nint dwExtraInfo; }

    [DllImport("user32.dll", SetLastError = true)] private static extern uint SendInput(uint n, INPUT[] inputs, int size);
    [DllImport("user32.dll")] private static extern bool SetCursorPos(int x, int y);

    private const uint INPUT_MOUSE = 0, INPUT_KEYBOARD = 1;
    private const uint LEFTDOWN = 0x02, LEFTUP = 0x04, RIGHTDOWN = 0x08, RIGHTUP = 0x10, WHEEL = 0x0800;
    private const uint KEYUP = 0x02, UNICODE = 0x04;

    private static readonly Dictionary<string, ushort> Keys = new()
    {
        ["Enter"] = 0x0D, ["Backspace"] = 0x08, ["Tab"] = 0x09, ["Escape"] = 0x1B,
        ["ctrl"] = 0x11, ["alt"] = 0x12, ["shift"] = 0x10, ["win"] = 0x5B,
        ["c"] = 0x43, ["v"] = 0x56, ["z"] = 0x5A, ["a"] = 0x41, ["d"] = 0x44,
    };

    private static readonly HashSet<string> AllowedShortcuts = new() { "ctrl+c", "ctrl+v", "ctrl+z", "ctrl+a", "alt+tab", "win", "win+d" };

    public static event Action<string> Blocked;

    private static void Mouse(uint flags, int data = 0)
    {
        var i = new INPUT { type = INPUT_MOUSE, u = new InputUnion { mi = new MOUSEINPUT { dwFlags = flags, mouseData = data } } };
        SendInput(1, new[] { i }, Marshal.SizeOf<INPUT>());
    }

    private static INPUT Key(ushort vk, bool up) =>
        new() { type = INPUT_KEYBOARD, u = new InputUnion { ki = new KEYBDINPUT { wVk = vk, dwFlags = up ? KEYUP : 0 } } };

    private static void MoveTo(JsonElement c, string xk = "x", string yk = "y")
    {
        var b = Screen.PrimaryScreen!.Bounds;
        double x = c.TryGetProperty(xk, out var px) ? px.GetDouble() : 0.5;
        double y = c.TryGetProperty(yk, out var py) ? py.GetDouble() : 0.5;
        SetCursorPos(b.Left + (int)(Math.Clamp(x, 0, 1) * b.Width), b.Top + (int)(Math.Clamp(y, 0, 1) * b.Height));
    }

    private static bool FocusedIsSensitive()
    {
        try
        {
            var el = AutomationElement.FocusedElement;
            if (el == null) return false;
            if (el.Current.IsPassword) return true;
            var hay = $"{el.Current.Name} {el.Current.AutomationId} {el.Current.HelpText}".ToLowerInvariant();
            return new[] { "password", "palavra-passe", "senha", "pin", "cvv", "iban", "cartão", "cartao", "card" }.Any(hay.Contains);
        }
        catch { return false; }
    }

    public static void Execute(JsonElement cmd)
    {
        var type = cmd.TryGetProperty("type", out var t) ? t.GetString() : "";
        switch (type)
        {
            case "move": MoveTo(cmd); break;
            case "tap":
            case "click": MoveTo(cmd); Mouse(LEFTDOWN); Mouse(LEFTUP); break;
            case "double_click": MoveTo(cmd); Mouse(LEFTDOWN); Mouse(LEFTUP); Thread.Sleep(60); Mouse(LEFTDOWN); Mouse(LEFTUP); break;
            case "right_click": MoveTo(cmd); Mouse(RIGHTDOWN); Mouse(RIGHTUP); break;
            case "swipe":
                MoveTo(cmd, "x1", "y1"); Mouse(LEFTDOWN); Thread.Sleep(40);
                MoveTo(cmd, "x2", "y2"); Thread.Sleep(40); Mouse(LEFTUP); break;
            case "scroll":
                MoveTo(cmd);
                Mouse(WHEEL, (cmd.TryGetProperty("dy", out var dy) && dy.GetInt32() > 0 ? -1 : 1) * 120 * 3); break;
            case "text": TypeText(cmd.TryGetProperty("text", out var tx) ? tx.GetString() ?? "" : ""); break;
            case "key":
                var k = cmd.TryGetProperty("key", out var kv) ? kv.GetString() : "";
                if (k != null && Keys.TryGetValue(k, out var vk)) SendInput(2, new[] { Key(vk, false), Key(vk, true) }, Marshal.SizeOf<INPUT>());
                break;
            case "shortcut": Shortcut(cmd.TryGetProperty("keys", out var ks) ? ks.GetString() ?? "" : ""); break;
        }
    }

    private static void TypeText(string text)
    {
        if (FocusedIsSensitive()) { Blocked?.Invoke("Campo protegido: o técnico não pode escrever palavras-passe, PIN, cartões ou IBAN."); return; }
        var list = new List<INPUT>();
        foreach (var ch in text.Take(500))
        {
            list.Add(new INPUT { type = INPUT_KEYBOARD, u = new InputUnion { ki = new KEYBDINPUT { wScan = ch, dwFlags = UNICODE } } });
            list.Add(new INPUT { type = INPUT_KEYBOARD, u = new InputUnion { ki = new KEYBDINPUT { wScan = ch, dwFlags = UNICODE | KEYUP } } });
        }
        if (list.Count > 0) SendInput((uint)list.Count, list.ToArray(), Marshal.SizeOf<INPUT>());
    }

    private static void Shortcut(string combo)
    {
        if (!AllowedShortcuts.Contains(combo)) return;
        var vks = combo.Split('+').Select(p => Keys[p]).ToList();
        var seq = vks.Select(v => Key(v, false)).Concat(Enumerable.Reverse(vks).Select(v => Key(v, true))).ToArray();
        SendInput((uint)seq.Length, seq, Marshal.SizeOf<INPUT>());
    }
}
