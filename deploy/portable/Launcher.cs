using System;
using System.Diagnostics;
using System.IO;
using System.Security;

public static class Launcher
{
    // The profile resolved by Windows may use an installed profile redirect.
    // Do not select a relative working directory or follow a redirected app leaf.
    private static string DefaultDataDirectory()
    {
        var local = Environment.GetEnvironmentVariable("LOCALAPPDATA");
        if (String.IsNullOrEmpty(local))
            local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData, Environment.SpecialFolderOption.DoNotVerify);

        // .NET Framework's IsPathRooted also accepts drive-relative paths.
        // Only a canonical local drive path is valid for the automatic default.
        local = (local ?? String.Empty).TrimEnd(Path.DirectorySeparatorChar);
        if (local.Length < 4 || !IsDriveLetter(local[0]) || local[1] != ':' ||
            local[2] != Path.DirectorySeparatorChar ||
            !String.Equals(Path.GetFullPath(local), local, StringComparison.OrdinalIgnoreCase))
            throw new ArgumentException("Invalid local profile directory.");

        var data = Path.Combine(local, "XIUMI AI Studio");
        CheckDefaultDataDirectory(data, true);
        Directory.CreateDirectory(data);
        CheckDefaultDataDirectory(data, false);
        return data;
    }

    private static bool IsDriveLetter(char c)
    {
        return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z');
    }

    private static void CheckDefaultDataDirectory(string data, bool allowMissing)
    {
        try
        {
            var attributes = File.GetAttributes(data);
            if ((attributes & FileAttributes.ReparsePoint) != 0 || (attributes & FileAttributes.Directory) == 0)
                throw new IOException("Not an ordinary application data directory.");
        }
        catch (FileNotFoundException) { if (!allowMissing) throw; }
        catch (DirectoryNotFoundException) { if (!allowMissing) throw; }
    }

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
        start.EnvironmentVariables["XIUMI_OWNED_PORTABLE_LAUNCH"] = "1";
        if (String.IsNullOrEmpty(start.EnvironmentVariables["DATA_DIR"]))
        {
            try
            {
                start.EnvironmentVariables["DATA_DIR"] = DefaultDataDirectory();
            }
            catch (Exception error)
            {
                if (!(error is ArgumentException || error is IOException || error is UnauthorizedAccessException ||
                    error is SecurityException || error is NotSupportedException)) throw;
                Console.Error.WriteLine("Cannot use Windows Local AppData. Check its path and permissions, or set DATA_DIR explicitly before launching.");
                return 1;
            }
        }
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
