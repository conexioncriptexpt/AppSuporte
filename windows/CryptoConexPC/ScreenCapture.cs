using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using Vortice.Direct3D;
using Vortice.Direct3D11;
using Vortice.DXGI;

namespace CryptoConexPC;

/// <summary>Primary-screen capture with the Desktop Duplication API, falling back to GDI when unavailable.</summary>
public sealed class ScreenCapture : IDisposable
{
    private ID3D11Device _device;
    private ID3D11DeviceContext _ctx;
    private IDXGIOutputDuplication _dup;
    private ID3D11Texture2D _staging;
    private byte[] _last;
    public int Width { get; private set; }
    public int Height { get; private set; }
    public bool UsingDuplication => _dup != null;

    public ScreenCapture()
    {
        var b = Screen.PrimaryScreen!.Bounds;
        Width = b.Width & ~1;
        Height = b.Height & ~1;
        TryInitDuplication();
    }

    private void TryInitDuplication()
    {
        try
        {
            D3D11.D3D11CreateDevice(null, DriverType.Hardware, DeviceCreationFlags.BgraSupport, null, out _device, out _ctx).CheckError();
            using var dxgiDevice = _device.QueryInterface<IDXGIDevice>();
            using var adapter = dxgiDevice.GetAdapter();
            adapter.EnumOutputs(0, out IDXGIOutput output).CheckError();
            using var output1 = output.QueryInterface<IDXGIOutput1>();
            _dup = output1.DuplicateOutput(_device);
            var r = output.Description.DesktopCoordinates;
            output.Dispose();
            Width = (r.Right - r.Left) & ~1;
            Height = (r.Bottom - r.Top) & ~1;
            _staging = _device.CreateTexture2D(new Texture2DDescription
            {
                Width = (uint)Width, Height = (uint)Height, MipLevels = 1, ArraySize = 1,
                Format = Format.B8G8R8A8_UNorm, SampleDescription = new SampleDescription(1, 0),
                Usage = ResourceUsage.Staging, CPUAccessFlags = CpuAccessFlags.Read, BindFlags = BindFlags.None,
            });
        }
        catch
        {
            ReleaseDuplication();
        }
    }

    private void ReleaseDuplication()
    {
        _staging?.Dispose(); _staging = null;
        _dup?.Dispose(); _dup = null;
        _ctx?.Dispose(); _ctx = null;
        _device?.Dispose(); _device = null;
    }

    /// <summary>Returns a BGRA frame (Width*Height*4). Reuses the last frame when the screen did not change.</summary>
    public byte[] Capture()
    {
        if (_dup != null)
        {
            try { return CaptureDuplication(); }
            catch { ReleaseDuplication(); TryInitDuplication(); }
        }
        return CaptureGdi();
    }

    private byte[] CaptureDuplication()
    {
        var res = _dup.AcquireNextFrame(50, out _, out IDXGIResource resource);
        if (res.Failure)
        {
            if (res.Code == Vortice.DXGI.ResultCode.WaitTimeout.Code && _last != null) return _last;
            if (res.Code == Vortice.DXGI.ResultCode.WaitTimeout.Code) return CaptureGdi();
            throw new InvalidOperationException("duplication lost");
        }
        try
        {
            using var tex = resource.QueryInterface<ID3D11Texture2D>();
            _ctx.CopyResource(_staging, tex);
            var map = _ctx.Map(_staging, 0, MapMode.Read, Vortice.Direct3D11.MapFlags.None);
            var buf = new byte[Width * Height * 4];
            int row = Width * 4;
            for (int y = 0; y < Height; y++)
                Marshal.Copy(map.DataPointer + (nint)(y * map.RowPitch), buf, y * row, row);
            _ctx.Unmap(_staging, 0);
            _last = buf;
            return buf;
        }
        finally
        {
            resource.Dispose();
            _dup.ReleaseFrame();
        }
    }

    private byte[] CaptureGdi()
    {
        using var bmp = new Bitmap(Width, Height, PixelFormat.Format32bppArgb);
        using (var g = Graphics.FromImage(bmp))
            g.CopyFromScreen(Screen.PrimaryScreen!.Bounds.Location, Point.Empty, new Size(Width, Height));
        var data = bmp.LockBits(new Rectangle(0, 0, Width, Height), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
        var buf = new byte[Width * Height * 4];
        for (int y = 0; y < Height; y++)
            Marshal.Copy(data.Scan0 + y * data.Stride, buf, y * Width * 4, Width * 4);
        bmp.UnlockBits(data);
        _last = buf;
        return buf;
    }

    public void Dispose() => ReleaseDuplication();
}
