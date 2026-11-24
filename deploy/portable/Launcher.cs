using System;
using System.Diagnostics;
using System.IO;
using System.Security;

public static class Launcher
{
    // The profile resolved by Windows may use an installed profile redirect.
    // Do not select a relative working directory or follow a redirected app leaf.
    private static string DefaultDataDirectory(ref string stage)
    {
        var local = Environment.GetEnvironmentVariable("LOCALAPPDATA");
        if (String.IsNullOrEmpty(local))
            local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData, Environment.SpecialFolderOption.DoNotVerify);

        // Validate the input before normalizing it. GetFullPath can expand
        // legitimate Windows 8.3 components (e.g. in the profile parent).
        local = NormalizeProfilePath(local);
        var data = Path.Combine(local, "XIUMI AI Studio");
        stage = "application-directory-preflight";
        CheckDefaultDataDirectory(data, true);
        stage = "application-directory-create";
        Directory.CreateDirectory(data);
        stage = "application-directory-verification";
        CheckDefaultDataDirectory(data, false);
        return data;
    }

    private static string NormalizeProfilePath(string local)
    {
        local = (local ?? String.Empty).TrimEnd(Path.DirectorySeparatorChar);
        // .NET Framework's IsPathRooted also accepts drive-relative paths.
        if (local.Length < 4 || !IsDriveLetter(local[0]) || local[1] != ':' ||
            local[2] != Path.DirectorySeparatorChar)
            throw new ArgumentException("Invalid local profile directory.");

        var invalidCharacters = Path.GetInvalidFileNameChars();
        foreach (var segment in local.Substring(3).Split(Path.DirectorySeparatorChar))
        {
            // Forbid aliases that would select a different directory through
            // traversal, trailing dot/space trimming, or a stream/device path.
            if (segment.Length == 0 || segment.EndsWith(".", StringComparison.Ordinal) ||
                segment.EndsWith(" ", StringComparison.Ordinal) || segment.IndexOfAny(invalidCharacters) >= 0)
                throw new ArgumentException("Invalid local profile directory.");
        }
        return Path.GetFullPath(local);
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
            var stage = "profile-path";
            try
            {
                start.EnvironmentVariables["DATA_DIR"] = DefaultDataDirectory(ref stage);
            }
            catch (Exception error)
            {
                if (!(error is ArgumentException || error is IOException || error is UnauthorizedAccessException ||
                    error is SecurityException || error is NotSupportedException)) throw;
                Console.Error.WriteLine("Cannot use Windows Local AppData. Check its path and permissions, or set DATA_DIR explicitly before launching.");
                Console.Error.WriteLine("XIUMI_PORTABLE_APPDATA:" + stage);
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
