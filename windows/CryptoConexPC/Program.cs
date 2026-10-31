using System.Reflection;

namespace CryptoConexPC;

internal static class Program
{
    public static string BackendUrl =>
        typeof(Program).Assembly.GetCustomAttributes<AssemblyMetadataAttribute>()
            .FirstOrDefault(a => a.Key == "BackendUrl")?.Value?.TrimEnd('/') ?? "";

    [STAThread]
    private static void Main()
    {
        using var single = new Mutex(true, "CryptoConexPC.Single", out bool first);
        if (!first) return;
        ApplicationConfiguration.Initialize();
        Application.Run(new MainForm());
    }
}
