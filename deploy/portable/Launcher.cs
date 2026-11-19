using System;
using System.Diagnostics;
using System.IO;

public static class Launcher
{
    public static int Main()
    {
        var home = AppDomain.CurrentDomain.BaseDirectory;
        var app = Path.Combine(home, "app");
        var runtime = Path.Combine(home, "runtime", "node.exe");
        var entry = Path.Combine(app, "server", "index.mjs");
        if (!File.Exists(runtime) || !File.Exists(entry))
        {
            Console.Error.WriteLine("Extract the complete XIUMI AI Studio archive before launching.");
            return 1;
        }

        var start = new ProcessStartInfo(runtime, "server/index.mjs");
        start.WorkingDirectory = app;
        start.UseShellExecute = false;
        start.RedirectStandardOutput = true;
        start.RedirectStandardError = true;
        start.EnvironmentVariables["NODE_ENV"] = "production";
        start.EnvironmentVariables.Remove("NODE_OPTIONS");
        start.EnvironmentVariables.Remove("NODE_PATH");

        using (var child = new Process { StartInfo = start })
        {
            // Explicit relay keeps diagnostics and listener readiness visible
            // even when this launcher itself is started with redirected output.
            child.OutputDataReceived += (sender, eventArgs) =>
            {
                if (eventArgs.Data != null) Console.Out.WriteLine(eventArgs.Data);
            };
            child.ErrorDataReceived += (sender, eventArgs) =>
            {
                if (eventArgs.Data != null) Console.Error.WriteLine(eventArgs.Data);
            };
            if (!child.Start()) return 1;
            child.BeginOutputReadLine();
            child.BeginErrorReadLine();
            child.WaitForExit();
            return child.ExitCode;
        }
    }
}
