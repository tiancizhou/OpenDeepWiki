using System.Collections.Concurrent;
using System.ComponentModel;
using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;
using LibGit2Sharp;
using Microsoft.Extensions.AI;
using GitRepository = LibGit2Sharp.Repository;

namespace OpenDeepWiki.Agents.Tools;

/// <summary>
/// Workspace metadata for initializing GitTool with optional remote fetch credentials.
/// </summary>
public sealed record GitWorkspaceConfig(
    string RepoName,
    string WorkingDirectory,
    string? BranchName = null,
    string? AuthAccount = null,
    string? AuthPassword = null);

/// <summary>
/// Unified AI Tool for repository file operations including read, search, list, and Git change history.
/// All file paths are relative to the repository root - actual filesystem paths are abstracted.
/// </summary>
public class GitTool
{
    private sealed record RepoWorkspace(
        string RepoName,
        string WorkingDirectory,
        List<GitIgnoreRule> GitIgnoreRules,
        string? BranchName = null,
        string? AuthAccount = null,
        string? AuthPassword = null);

    private static readonly TimeSpan BeijingOffset = TimeSpan.FromHours(8);
    private static readonly TimeSpan RemoteFetchCooldown = TimeSpan.FromMinutes(3);
    private static readonly ConcurrentDictionary<string, DateTimeOffset> LastRemoteFetchAt = new(StringComparer.OrdinalIgnoreCase);
    private static readonly ConcurrentDictionary<string, SemaphoreSlim> RemoteFetchLocks = new(StringComparer.OrdinalIgnoreCase);

    private readonly string _workingDirectory;
    private readonly List<GitIgnoreRule> _gitIgnoreRules;
    private readonly List<RepoWorkspace> _workspaces;
    private readonly HashSet<string> _readFiles = new(StringComparer.OrdinalIgnoreCase);

    /// <summary>
    /// Default maximum number of lines to read from a file.
    /// </summary>
    private const int DefaultReadLimit = 2000;

    /// <summary>
    /// Maximum characters per line before truncation.
    /// </summary>
    private const int MaxLineLength = 2000;

    /// <summary>
    /// Default context lines for grep results.
    /// </summary>
    private const int DefaultContextLines = 2;

    /// <summary>
    /// Initializes a new instance of GitTool with the specified working directory.
    /// </summary>
    /// <param name="workingDirectory">The absolute path to the repository working directory.</param>
    public GitTool(string workingDirectory)
    {
        if (string.IsNullOrWhiteSpace(workingDirectory))
        {
            throw new ArgumentException("Working directory cannot be empty.", nameof(workingDirectory));
        }

        _workingDirectory = Path.GetFullPath(workingDirectory);

        if (!Directory.Exists(_workingDirectory))
        {
            throw new DirectoryNotFoundException($"Working directory does not exist: {_workingDirectory}");
        }

        // 解析 .gitignore 文件
        _gitIgnoreRules = RepositoryFileFilter.ParseGitIgnore(_workingDirectory);
        _workspaces = [new RepoWorkspace(string.Empty, _workingDirectory, _gitIgnoreRules)];
    }

    /// <summary>
    /// Initializes a new instance of GitTool across one or more repositories in a system group/app.
    /// </summary>
    public GitTool(IEnumerable<(string RepoName, string WorkingDirectory)> repositories)
        : this(repositories?.Select(r => new GitWorkspaceConfig(r.RepoName, r.WorkingDirectory))!)
    {
    }

    /// <summary>
    /// Initializes a new instance of GitTool across one or more configured repository workspaces.
    /// </summary>
    public GitTool(IEnumerable<GitWorkspaceConfig> workspaces)
    {
        ArgumentNullException.ThrowIfNull(workspaces);

        var resolvedWorkspaces = new List<RepoWorkspace>();
        var seenDirs = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (var item in workspaces)
        {
            if (string.IsNullOrWhiteSpace(item.WorkingDirectory)) continue;
            var fullDir = Path.GetFullPath(item.WorkingDirectory);
            if (!Directory.Exists(fullDir) || !seenDirs.Add(fullDir)) continue;

            var ignoreRules = RepositoryFileFilter.ParseGitIgnore(fullDir);
            resolvedWorkspaces.Add(new RepoWorkspace(
                item.RepoName?.Trim() ?? string.Empty,
                fullDir,
                ignoreRules,
                item.BranchName,
                item.AuthAccount,
                item.AuthPassword));
        }

        if (resolvedWorkspaces.Count == 0)
        {
            throw new DirectoryNotFoundException("None of the specified repository working directories exist.");
        }

        _workspaces = resolvedWorkspaces;
        _workingDirectory = resolvedWorkspaces[0].WorkingDirectory;
        _gitIgnoreRules = resolvedWorkspaces[0].GitIgnoreRules;
    }

    /// <summary>
    /// Gets the list of files that have been read by this tool instance.
    /// </summary>
    /// <returns>A list of relative file paths that were read.</returns>
    public List<string> GetReadFiles()
    {
        return _readFiles.OrderBy(f => f).ToList();
    }

    /// <summary>
    /// Clears the list of tracked read files.
    /// </summary>
    public void ClearReadFiles()
    {
        _readFiles.Clear();
    }

    /// <summary>
    /// Enumerates files across all configured repository workspaces matching a glob pattern.
    /// </summary>
    private IEnumerable<(RepoWorkspace Workspace, string FullPath, string DisplayRelativePath)> EnumerateWorkspaceFilesWithGlob(string? glob)
    {
        var globRegex = string.IsNullOrWhiteSpace(glob) ? null : GlobToRegex(glob);
        var isMultiRepo = _workspaces.Count > 1;

        foreach (var ws in _workspaces)
        {
            if (!Directory.Exists(ws.WorkingDirectory)) continue;

            foreach (var file in Directory.EnumerateFiles(ws.WorkingDirectory, "*", SearchOption.AllDirectories))
            {
                var relPath = GetRelativePath(ws.WorkingDirectory, file);
                if (IsIgnoredByGitIgnore(relPath, ws.GitIgnoreRules)) continue;

                var displayPath = isMultiRepo && !string.IsNullOrEmpty(ws.RepoName)
                    ? $"{ws.RepoName}/{relPath}"
                    : relPath;

                if (globRegex == null || globRegex.IsMatch(relPath) || globRegex.IsMatch(displayPath))
                {
                    yield return (ws, file, displayPath);
                }
            }
        }
    }

    private (RepoWorkspace Workspace, string FullPath, string DisplayRelativePath)? ResolveWorkspaceFile(string relativePath)
    {
        var cleanInput = relativePath.Replace('\\', '/').TrimStart('/');
        var isMultiRepo = _workspaces.Count > 1;

        // 1. Check if prefixed with repository name: "<repoName>/<path>"
        var slashIdx = cleanInput.IndexOf('/');
        if (slashIdx > 0)
        {
            var prefix = cleanInput[..slashIdx];
            var remainder = cleanInput[(slashIdx + 1)..];
            var matchedWs = _workspaces.FirstOrDefault(w =>
                !string.IsNullOrEmpty(w.RepoName) &&
                string.Equals(w.RepoName, prefix, StringComparison.OrdinalIgnoreCase));

            if (matchedWs != null)
            {
                var normRem = NormalizePath(remainder);
                var candidateFull = Path.GetFullPath(Path.Combine(matchedWs.WorkingDirectory, normRem));
                if (candidateFull.StartsWith(matchedWs.WorkingDirectory, StringComparison.OrdinalIgnoreCase) &&
                    File.Exists(candidateFull))
                {
                    var rel = GetRelativePath(matchedWs.WorkingDirectory, candidateFull);
                    var disp = isMultiRepo ? $"{matchedWs.RepoName}/{rel}" : rel;
                    return (matchedWs, candidateFull, disp);
                }
            }
        }

        // 2. Check direct relative path in each workspace
        var normalizedPath = NormalizePath(relativePath);
        foreach (var ws in _workspaces)
        {
            var candidateFull = Path.GetFullPath(Path.Combine(ws.WorkingDirectory, normalizedPath));
            if (!candidateFull.StartsWith(ws.WorkingDirectory, StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            if (File.Exists(candidateFull))
            {
                var rel = GetRelativePath(ws.WorkingDirectory, candidateFull);
                var disp = isMultiRepo && !string.IsNullOrEmpty(ws.RepoName) ? $"{ws.RepoName}/{rel}" : rel;
                return (ws, candidateFull, disp);
            }
        }

        // 3. Fallback: if no traversal ("..") was requested and caller passed a filename or partial suffix (e.g. "ProjectStus.java"), locate matching file
        if (!relativePath.Contains("..", StringComparison.Ordinal))
        {
            var targetForward = normalizedPath.Replace('\\', '/');
            var targetFileName = Path.GetFileName(targetForward);
            if (!string.IsNullOrWhiteSpace(targetFileName))
            {
                foreach (var item in EnumerateWorkspaceFilesWithGlob(null))
                {
                    if (IsHiddenPath(item.Workspace.WorkingDirectory, item.FullPath)) continue;
                    var itemRel = GetRelativePath(item.Workspace.WorkingDirectory, item.FullPath);
                    if (string.Equals(itemRel, targetForward, StringComparison.OrdinalIgnoreCase) ||
                        itemRel.EndsWith("/" + targetForward, StringComparison.OrdinalIgnoreCase) ||
                        string.Equals(Path.GetFileName(itemRel), targetFileName, StringComparison.OrdinalIgnoreCase))
                    {
                        return item;
                    }
                }
            }
        }

        return null;
    }

    /// <summary>
    /// Converts a glob pattern to a regex pattern.
    /// Supports: * (any chars except /), ** (any chars including /), ? (single char)
    /// </summary>
    private static Regex GlobToRegex(string glob)
    {
        var pattern = new StringBuilder("^");

        for (int i = 0; i < glob.Length; i++)
        {
            var c = glob[i];
            switch (c)
            {
                case '*':
                    if (i + 1 < glob.Length && glob[i + 1] == '*')
                    {
                        // ** matches any path including /
                        pattern.Append(".*");
                        i++; // Skip next *
                        // Skip trailing / after **
                        if (i + 1 < glob.Length && (glob[i + 1] == '/' || glob[i + 1] == '\\'))
                        {
                            i++;
                        }
                    }
                    else
                    {
                        // * matches any chars except /
                        pattern.Append("[^/\\\\]*");
                    }

                    break;
                case '?':
                    pattern.Append("[^/\\\\]");
                    break;
                case '.':
                case '(':
                case ')':
                case '[':
                case ']':
                case '{':
                case '}':
                case '+':
                case '^':
                case '$':
                case '|':
                    pattern.Append('\\').Append(c);
                    break;
                case '\\':
                case '/':
                    pattern.Append("[/\\\\]");
                    break;
                default:
                    pattern.Append(c);
                    break;
            }
        }

        pattern.Append('$');
        return new Regex(pattern.ToString(), RegexOptions.IgnoreCase | RegexOptions.Compiled);
    }

    /// <summary>
    /// Reads the content of a file at the specified relative path.
    /// </summary>
    /// <param name="relativePath">The path relative to the repository root.</param>
    /// <param name="offset">Line number to start reading from (1-based).</param>
    /// <param name="limit">Maximum number of lines to read.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The file content as a string with line numbers.</returns>
    [Description(@"Reads a file from the repository.

Usage:
- The path parameter must be relative to the repository root (e.g., 'src/main.cs', 'README.md')
- By default reads up to 2000 lines starting from the beginning
- You can optionally specify offset and limit for large files
- Lines longer than 2000 characters will be truncated
- Results include line numbers in 'N: content' format
- Binary files (images, executables, etc.) are not supported
- Hidden files/directories (starting with .) are accessible but filtered in search results")]
    public async Task<string> ReadAsync(
        [Description("Relative path to the file from repository root, e.g., 'src/main.cs' or 'docs/README.md'")]
        string relativePath,
        [Description("Line number to start reading from (1-based). Use for large files. Default: 1")]
        int offset = 1,
        [Description("Maximum number of lines to read. Use for large files. Default: 2000")]
        int limit = DefaultReadLimit,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(relativePath))
        {
            return "ERROR: Relative path cannot be empty. Please provide a valid file path relative to the repository root.";
        }

        try
        {
            var resolved = ResolveWorkspaceFile(relativePath);
            if (resolved == null)
            {
                var normalizedPath = NormalizePath(relativePath);
                var fullPath = Path.GetFullPath(Path.Combine(_workingDirectory, normalizedPath));
                if (!fullPath.StartsWith(_workingDirectory, StringComparison.OrdinalIgnoreCase))
                {
                    return $"ERROR: Access denied. The path '{relativePath}' is outside the repository boundaries. Please use a path relative to the repository root.";
                }

                return $"ERROR: File not found at path '{relativePath}'. Please verify the file path is correct and the file exists in the repository.";
            }

            var (_, matchedFullPath, displayRelativePath) = resolved.Value;
            var lines = await File.ReadAllLinesAsync(matchedFullPath, cancellationToken);
            var startIndex = Math.Max(0, offset - 1);
            var endIndex = Math.Min(lines.Length, startIndex + limit);

            // 记录读取的文件
            _readFiles.Add(displayRelativePath);

            var result = new StringBuilder();
            for (int i = startIndex; i < endIndex; i++)
            {
                var line = lines[i];
                if (line.Length > MaxLineLength)
                {
                    line = line[..MaxLineLength] + "... [truncated]";
                }

                result.AppendLine($"{i + 1}: {line}");
            }

            if (endIndex < lines.Length)
            {
                result.AppendLine($"[{lines.Length - endIndex} more lines not shown. Use offset/limit to read more.]");
            }

            return result.ToString();
        }
        catch (UnauthorizedAccessException)
        {
            return $"ERROR: Permission denied when trying to read '{relativePath}'. The file may have restricted access permissions.";
        }
        catch (IOException ex)
        {
            return $"ERROR: Failed to read file '{relativePath}'. IO error: {ex.Message}";
        }
        catch (Exception ex)
        {
            return $"ERROR: Unexpected error reading file '{relativePath}': {ex.Message}";
        }
    }

    /// <summary>
    /// Searches for patterns in repository files.
    /// </summary>
    /// <param name="pattern">The search pattern (supports regex).</param>
    /// <param name="glob">Optional glob pattern to filter files.</param>
    /// <param name="caseSensitive">Whether the search is case sensitive.</param>
    /// <param name="contextLines">Number of context lines before and after each match.</param>
    /// <param name="maxResults">Maximum number of results to return.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    [Description(@"A powerful search tool for finding patterns in repository files.

Usage:
- Supports full regex syntax (e.g., 'log.*Error', 'function\s+\w+', 'class\s+\w+')
- Filter files with glob parameter (e.g., '*.cs', '*.ts', '**/*.json')
- Use caseSensitive=false for case-insensitive search (default)
- Context lines show surrounding code for better understanding
- Binary files and hidden directories (starting with .) are automatically skipped
- Results are capped at maxResults to prevent overwhelming output

Pattern Examples:
- Find class definitions: 'class\s+\w+'
- Find TODO comments: 'TODO|FIXME|HACK'
- Find function calls: 'functionName\s*\('
- Find imports: '^using|^import'")]
    public async Task<GrepResult[]> GrepAsync(
        [Description("The regex pattern to search for in file contents. Supports full regex syntax.")]
        string pattern,
        [Description("Glob pattern to filter files (e.g., '*.cs', '*.ts', '**/*.json'). Default: all files")]
        string glob = "",
        [Description("Whether the search is case sensitive. Default: false")]
        bool caseSensitive = false,
        [Description("Number of context lines to show before and after each match. Default: 2")]
        int contextLines = DefaultContextLines,
        [Description("Maximum number of results to return. Default: 50")]
        int maxResults = 50,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(pattern))
        {
            return new[]
            {
                new GrepResult
                {
                    FilePath = "ERROR",
                    LineNumber = 0,
                    LineContent = "Search pattern cannot be empty. Please provide a valid regex pattern to search for.",
                    Context = "Example patterns: 'class\\s+\\w+' for class definitions, 'TODO|FIXME' for comments, '^using|^import' for imports"
                }
            };
        }

        try
        {
            var regexOptions = RegexOptions.Compiled;
            if (!caseSensitive)
            {
                regexOptions |= RegexOptions.IgnoreCase;
            }

            var regex = new Regex(pattern, regexOptions);
            var results = new ConcurrentBag<GrepResult>();
            var resultCount = 0;

            await Task.Run(() =>
            {
                try
                {
                    var files = EnumerateWorkspaceFilesWithGlob(glob)
                        .Where(item => !RepositoryFileFilter.IsBinaryFile(item.FullPath) &&
                                       !IsHiddenPath(item.Workspace.WorkingDirectory, item.FullPath));

                    Parallel.ForEach(files, new ParallelOptions
                        {
                            CancellationToken = cancellationToken,
                            MaxDegreeOfParallelism = Environment.ProcessorCount
                        },
                        (item, state) =>
                        {
                            if (Volatile.Read(ref resultCount) >= maxResults)
                            {
                                state.Stop();
                                return;
                            }

                            try
                            {
                                SearchInFile(item.FullPath, item.DisplayRelativePath, regex, contextLines, maxResults, results, ref resultCount);
                            }
                            catch
                            {
                                // Skip files that cannot be read
                            }
                        });
                }
                catch (OperationCanceledException)
                {
                    // Cancelled
                }
                catch
                {
                    // Return empty results if directory enumeration fails
                }
            }, cancellationToken);

            return [.. results.OrderBy(r => r.FilePath).ThenBy(r => r.LineNumber).Take(maxResults)];
        }
        catch (ArgumentException ex)
        {
            return new[]
            {
                new GrepResult
                {
                    FilePath = "ERROR",
                    LineNumber = 0,
                    LineContent = $"Invalid regex pattern: {ex.Message}",
                    Context = "Please check your regex syntax. Common issues: unescaped special characters, unmatched brackets, invalid escape sequences."
                }
            };
        }
        catch (Exception ex)
        {
            return new[]
            {
                new GrepResult
                {
                    FilePath = "ERROR",
                    LineNumber = 0,
                    LineContent = $"Search failed: {ex.Message}",
                    Context = "An unexpected error occurred during the search operation."
                }
            };
        }
    }

    /// <summary>
    /// Searches for pattern matches in a single file.
    /// </summary>
    private void SearchInFile(string file, string relativePath, Regex regex, int contextLines, int maxResults,
        ConcurrentBag<GrepResult> results, ref int resultCount)
    {
        using var reader = new StreamReader(file);
        var lineBuffer = new Queue<string>(contextLines + 1);
        var lineNumber = 0;
        string? line;

        while ((line = reader.ReadLine()) != null && Volatile.Read(ref resultCount) < maxResults)
        {
            lineNumber++;

            if (regex.IsMatch(line))
            {
                var contextBuilder = new StringBuilder();

                // Add buffered context lines before
                var bufferLineNum = lineNumber - lineBuffer.Count;
                foreach (var bufLine in lineBuffer)
                {
                    contextBuilder.AppendLine($"  {bufferLineNum}: {TruncateLine(bufLine)}");
                    bufferLineNum++;
                }

                // Add matching line
                contextBuilder.AppendLine($"> {lineNumber}: {TruncateLine(line)}");

                // Read context lines after
                for (int j = 0; j < contextLines && Volatile.Read(ref resultCount) < maxResults; j++)
                {
                    var nextLine = reader.ReadLine();
                    if (nextLine == null) break;
                    lineNumber++;
                    contextBuilder.AppendLine($"  {lineNumber}: {TruncateLine(nextLine)}");

                    // Check if next line also matches
                    if (regex.IsMatch(nextLine))
                    {
                        lineBuffer.Clear();
                        lineBuffer.Enqueue(nextLine);
                    }
                }

                results.Add(new GrepResult
                {
                    FilePath = relativePath,
                    LineNumber = lineNumber - contextLines,
                    LineContent = line.Trim(),
                    Context = contextBuilder.ToString().TrimEnd()
                });

                Interlocked.Increment(ref resultCount);
                lineBuffer.Clear();
            }
            else
            {
                // Maintain rolling buffer for context
                if (lineBuffer.Count >= contextLines)
                {
                    lineBuffer.Dequeue();
                }

                lineBuffer.Enqueue(line);
            }
        }
    }

    /// <summary>
    /// Truncates a line if it exceeds the maximum length.
    /// </summary>
    private static string TruncateLine(string line)
    {
        return line.Length > MaxLineLength ? line[..MaxLineLength] + "..." : line;
    }

    /// <summary>
    /// Lists files in the repository matching the specified pattern.
    /// </summary>
    /// <param name="glob">Optional glob pattern filter.</param>
    /// <param name="maxResults">Maximum number of files to return.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>Array of relative file paths.</returns>
    [Description(@"Lists files in the repository matching the specified pattern.

Usage:
- Returns relative file paths from repository root
- Supports full glob syntax: *, **, ?
- Hidden files/directories (starting with .) are excluded by default
- Results are sorted alphabetically
- Use maxResults to limit output for large repositories

Glob Examples:
- List all C# files: glob='*.cs'
- List all files recursively: glob='**/*'
- List TypeScript in src: glob='src/**/*.ts'
- List JSON configs: glob='**/*.json'
- Single char wildcard: glob='file?.txt'")]
    public async Task<string[]> ListFilesAsync(
        [Description("Glob pattern (e.g., '*.cs', 'src/**/*.ts', '**/*.json'). Default: all files")]
        string glob = "",
        [Description("Maximum number of files to return. Default: 50. Use higher values (100-200) for comprehensive discovery.")]
        int maxResults = 50,
        CancellationToken cancellationToken = default)
    {
        return await Task.Run(() =>
        {
            return EnumerateWorkspaceFilesWithGlob(glob)
                .Where(item => !IsHiddenPath(item.Workspace.WorkingDirectory, item.FullPath))
                .Select(item => item.DisplayRelativePath)
                .OrderBy(f => f)
                .Take(maxResults)
                .ToArray();
        }, cancellationToken);
    }

    /// <summary>
    /// Normalizes a path by replacing backslashes with forward slashes and removing leading slashes.
    /// </summary>
    private static string NormalizePath(string path)
    {
        // Replace backslashes with forward slashes
        var normalized = path.Replace('\\', '/');

        // Remove leading slashes
        normalized = normalized.TrimStart('/');

        // Remove any ".." components to prevent directory traversal
        var parts = normalized.Split('/').Where(p => p != ".." && p != ".").ToArray();

        return string.Join(Path.DirectorySeparatorChar.ToString(), parts);
    }

    /// <summary>
    /// Gets the relative path from the specified working directory.
    /// </summary>
    private static string GetRelativePath(string workingDirectory, string fullPath)
    {
        var relativePath = Path.GetRelativePath(workingDirectory, fullPath);
        // Always use forward slashes for consistency
        return relativePath.Replace('\\', '/');
    }

    /// <summary>
    /// Checks if a file is likely binary based on extension.
    /// </summary>
    private static bool IsBinaryFile(string filePath)
    {
        var binaryExtensions = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            ".exe", ".dll", ".so", ".dylib", ".bin", ".obj", ".o",
            ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".ico", ".svg",
            ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
            ".zip", ".tar", ".gz", ".rar", ".7z",
            ".mp3", ".mp4", ".avi", ".mov", ".wav",
            ".ttf", ".otf", ".woff", ".woff2", ".eot",
            ".db", ".sqlite", ".mdb"
        };

        var extension = Path.GetExtension(filePath);
        return binaryExtensions.Contains(extension);
    }

    /// <summary>
    /// Checks if a path contains hidden directories (starting with .).
    /// </summary>
    private static bool IsHiddenPath(string workingDirectory, string fullPath)
    {
        var relativePath = GetRelativePath(workingDirectory, fullPath);
        var parts = relativePath.Split('/', '\\');

        // Check if any directory component starts with . (except current directory)
        return parts.Any(p => p.StartsWith('.') && p != ".");
    }

    /// <summary>
    /// Checks if a relative path should be ignored based on .gitignore rules.
    /// </summary>
    private static bool IsIgnoredByGitIgnore(string relativePath, List<GitIgnoreRule> gitIgnoreRules)
    {
        if (gitIgnoreRules.Count == 0)
        {
            return false;
        }

        // Normalize path separators
        var normalizedPath = relativePath.Replace('\\', '/');

        // Check each rule in order (later rules can override earlier ones)
        var isIgnored = false;
        foreach (var rule in gitIgnoreRules)
        {
            if (rule.Pattern.IsMatch(normalizedPath))
            {
                isIgnored = !rule.IsNegation;
            }
        }

        return isIgnored;
    }

    /// <summary>
    /// Parses .gitignore file and returns a list of ignore rules.
    /// </summary>
    /// <param name="workingDirectory">The repository root directory.</param>
    /// <returns>List of parsed gitignore rules.</returns>
    private static List<GitIgnoreRule> ParseGitIgnore(string workingDirectory)
    {
        var rules = new List<GitIgnoreRule>();
        var gitignorePath = Path.Combine(workingDirectory, ".gitignore");

        if (!File.Exists(gitignorePath))
        {
            return rules;
        }

        try
        {
            var lines = File.ReadAllLines(gitignorePath);
            foreach (var line in lines)
            {
                var trimmedLine = line.Trim();

                // Skip empty lines and comments
                if (string.IsNullOrEmpty(trimmedLine) || trimmedLine.StartsWith('#'))
                {
                    continue;
                }

                var rule = ParseGitIgnorePattern(trimmedLine);
                if (rule != null)
                {
                    rules.Add(rule);
                }
            }
        }
        catch
        {
            // If we can't read the file, return empty rules
        }

        return rules;
    }

    /// <summary>
    /// Parses a single gitignore pattern into a rule.
    /// </summary>
    /// <param name="pattern">The gitignore pattern string.</param>
    /// <returns>A GitIgnoreRule or null if the pattern is invalid.</returns>
    private static GitIgnoreRule? ParseGitIgnorePattern(string pattern)
    {
        var rule = new GitIgnoreRule
        {
            OriginalPattern = pattern,
            IsNegation = false,
            DirectoryOnly = false
        };

        var workingPattern = pattern;

        // Check for negation
        if (workingPattern.StartsWith('!'))
        {
            rule.IsNegation = true;
            workingPattern = workingPattern[1..];
        }

        // Check for directory-only pattern
        if (workingPattern.EndsWith('/'))
        {
            rule.DirectoryOnly = true;
            workingPattern = workingPattern.TrimEnd('/');
        }

        // Remove leading slash (anchors to root)
        var anchoredToRoot = workingPattern.StartsWith('/');
        if (anchoredToRoot)
        {
            workingPattern = workingPattern[1..];
        }

        // Convert gitignore pattern to regex
        var regexPattern = GitIgnorePatternToRegex(workingPattern, anchoredToRoot);

        try
        {
            rule.Pattern = new Regex(regexPattern, RegexOptions.IgnoreCase | RegexOptions.Compiled);
            return rule;
        }
        catch
        {
            // Invalid regex pattern
            return null;
        }
    }

    /// <summary>
    /// Converts a gitignore pattern to a regex pattern.
    /// </summary>
    private static string GitIgnorePatternToRegex(string pattern, bool anchoredToRoot)
    {
        var sb = new StringBuilder();

        // If pattern contains /, it's relative to root; otherwise match anywhere
        var containsSlash = pattern.Contains('/');

        if (anchoredToRoot || containsSlash)
        {
            sb.Append('^');
        }
        else
        {
            sb.Append("(^|/)");
        }

        for (int i = 0; i < pattern.Length; i++)
        {
            var c = pattern[i];
            switch (c)
            {
                case '*':
                    if (i + 1 < pattern.Length && pattern[i + 1] == '*')
                    {
                        // ** matches everything including /
                        if (i + 2 < pattern.Length && pattern[i + 2] == '/')
                        {
                            // **/ matches zero or more directories
                            sb.Append("(.*/)?");
                            i += 2;
                        }
                        else
                        {
                            sb.Append(".*");
                            i++;
                        }
                    }
                    else
                    {
                        // * matches everything except /
                        sb.Append("[^/]*");
                    }
                    break;
                case '?':
                    sb.Append("[^/]");
                    break;
                case '.':
                case '(':
                case ')':
                case '[':
                case ']':
                case '{':
                case '}':
                case '+':
                case '^':
                case '$':
                case '|':
                case '\\':
                    sb.Append('\\').Append(c);
                    break;
                default:
                    sb.Append(c);
                    break;
            }
        }

        sb.Append("(/.*)?$");
        return sb.ToString();
    }

    private sealed record CommitChangeEntry(
        string RepoName,
        string Sha,
        DateTimeOffset WhenBeijing,
        string AuthorName,
        string MessageTitle,
        string MessageBody,
        bool IsMerge,
        List<string> AddedFiles,
        List<string> ModifiedFiles,
        List<string> DeletedOrRenamedFiles);

    private static async Task EnsureRecentRemoteFetchAsync(RepoWorkspace ws, CancellationToken ct)
    {
        if (!Directory.Exists(ws.WorkingDirectory) || !GitRepository.IsValid(ws.WorkingDirectory))
        {
            return;
        }

        var now = DateTimeOffset.UtcNow;
        if (LastRemoteFetchAt.TryGetValue(ws.WorkingDirectory, out var lastFetch) &&
            now - lastFetch < RemoteFetchCooldown)
        {
            return;
        }

        var gate = RemoteFetchLocks.GetOrAdd(ws.WorkingDirectory, _ => new SemaphoreSlim(1, 1));
        var acquired = false;
        try
        {
            acquired = await gate.WaitAsync(TimeSpan.FromSeconds(3), ct);
            if (!acquired) return;

            if (LastRemoteFetchAt.TryGetValue(ws.WorkingDirectory, out lastFetch) &&
                DateTimeOffset.UtcNow - lastFetch < RemoteFetchCooldown)
            {
                return;
            }

            LastRemoteFetchAt[ws.WorkingDirectory] = DateTimeOffset.UtcNow;

            using var fetchCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            fetchCts.CancelAfter(TimeSpan.FromSeconds(6));

            var fetchTask = Task.Run(() =>
            {
                using var repo = new GitRepository(ws.WorkingDirectory);
                var remote = repo.Network.Remotes["origin"];
                if (remote == null) return;

                var refSpecs = remote.FetchRefSpecs.Select(x => x.Specification).ToArray();
                if (refSpecs.Length == 0) return;

                var fetchOptions = new FetchOptions
                {
                    CertificateCheck = (_, _, _) => true
                };

                if (!string.IsNullOrWhiteSpace(ws.AuthAccount) || !string.IsNullOrWhiteSpace(ws.AuthPassword))
                {
                    fetchOptions.CredentialsProvider = (_, _, _) => new UsernamePasswordCredentials
                    {
                        Username = ws.AuthAccount ?? string.Empty,
                        Password = ws.AuthPassword ?? string.Empty
                    };
                }

                // Read-only ref update into refs/remotes/origin/* without touching working tree
                Commands.Fetch(repo, remote.Name, refSpecs, fetchOptions, null);
            }, fetchCts.Token);

            await fetchTask.WaitAsync(fetchCts.Token);
        }
        catch
        {
            // Gracefully ignore remote network/auth timeouts and use existing local git commits
        }
        finally
        {
            if (acquired)
            {
                gate.Release();
            }
        }
    }

    private static List<Commit> CollectReachableBranchCommits(GitRepository repo, string? preferredBranch, int maxScan = 500)
    {
        var candidateTips = new List<Commit>();

        if (!string.IsNullOrWhiteSpace(preferredBranch))
        {
            var remotePreferred = repo.Branches[$"origin/{preferredBranch}"]?.Tip;
            if (remotePreferred != null) candidateTips.Add(remotePreferred);

            var localPreferred = repo.Branches[preferredBranch]?.Tip;
            if (localPreferred != null) candidateTips.Add(localPreferred);
        }

        var originMain = repo.Branches["origin/main"]?.Tip;
        if (originMain != null) candidateTips.Add(originMain);

        var originMaster = repo.Branches["origin/master"]?.Tip;
        if (originMaster != null) candidateTips.Add(originMaster);

        if (repo.Head?.Tip != null)
        {
            candidateTips.Add(repo.Head.Tip);
        }

        if (candidateTips.Count == 0)
        {
            return [];
        }

        var filter = new CommitFilter
        {
            IncludeReachableFrom = candidateTips.DistinctBy(c => c.Sha).ToList(),
            SortBy = CommitSortStrategies.Time
        };

        return repo.Commits.QueryBy(filter).Take(maxScan).ToList();
    }

    private static CommitChangeEntry BuildCommitChangeEntry(GitRepository repo, string repoLabel, Commit commit)
    {
        var whenBj = commit.Author.When.ToOffset(BeijingOffset);
        var fullMsg = (commit.Message ?? string.Empty).Trim();
        var firstNewline = fullMsg.IndexOf('\n');
        var title = firstNewline >= 0 ? fullMsg[..firstNewline].Trim() : fullMsg;
        var body = firstNewline >= 0 ? fullMsg[(firstNewline + 1)..].Trim() : string.Empty;
        var isMerge = commit.Parents.Count() > 1;

        var added = new List<string>();
        var modified = new List<string>();
        var deletedOrRenamed = new List<string>();

        try
        {
            var parentTree = commit.Parents.FirstOrDefault()?.Tree;
            var treeChanges = repo.Diff.Compare<TreeChanges>(parentTree, commit.Tree);
            foreach (var ch in treeChanges)
            {
                var relPath = ch.Path.Replace('\\', '/');
                switch (ch.Status)
                {
                    case ChangeKind.Added:
                        added.Add(relPath);
                        break;
                    case ChangeKind.Modified:
                        modified.Add(relPath);
                        break;
                    case ChangeKind.Renamed:
                        deletedOrRenamed.Add($"[重命名] {ch.OldPath.Replace('\\', '/')} -> {relPath}");
                        break;
                    case ChangeKind.Deleted:
                        deletedOrRenamed.Add($"[删除] {relPath}");
                        break;
                }
            }
        }
        catch
        {
            // Ignore diff failure on corrupted tree objects
        }

        return new CommitChangeEntry(
            repoLabel,
            commit.Sha,
            whenBj,
            commit.Author.Name ?? "unknown",
            title,
            body,
            isMerge,
            added,
            modified,
            deletedOrRenamed);
    }

    [Description(@"Queries Git commit history and daily added/modified files across repository workspaces within a Beijing-time date range.

Usage:
- Call this whenever the user asks what content/features/code were added, modified, or updated today, yesterday, daily, this week, or on a specific date.
- Supports date strings like '2026-11-13', 'today', 'yesterday', '本周', '最近7天', or leave empty to view the last 7 days grouped by date.
- Pair with GetGitCommitDiff to inspect concrete code changes and summarize business-level additions and modifications.")]
    public async Task<string> GetGitChangesAsync(
        [Description("Start date in YYYY-MM-DD or keyword like 'today', 'yesterday', '本周', '7d' (Beijing time). Leave empty for last 7 days.")]
        string sinceDate = "",
        [Description("End date in YYYY-MM-DD (inclusive, Beijing time). Leave empty to match sinceDate or today.")]
        string untilDate = "",
        [Description("Optional author name filter (case-insensitive substring).")]
        string author = "",
        [Description("Optional sub-repository name filter when multiple repositories exist.")]
        string repoName = "",
        [Description("Maximum commits to return (default: 40, max: 100).")]
        int maxCommits = 40,
        CancellationToken cancellationToken = default)
    {
        var (sinceBj, untilBj, rangeLabel) = WikiChangeReportTool.ParseBeijingDateWindow(sinceDate, untilDate);
        var (report, _) = await QueryGitChangesCoreAsync(sinceBj, untilBj, rangeLabel, author, repoName, maxCommits, cancellationToken);
        return report;
    }

    private async Task<(string FormattedReport, List<CommitChangeEntry> MatchedCommits)> QueryGitChangesCoreAsync(
        DateTimeOffset sinceBj,
        DateTimeOffset untilBj,
        string rangeLabel,
        string author,
        string repoName,
        int maxCommits,
        CancellationToken cancellationToken)
    {
        maxCommits = Math.Clamp(maxCommits <= 0 ? 40 : maxCommits, 1, 100);

        var targetWorkspaces = string.IsNullOrWhiteSpace(repoName)
            ? _workspaces
            : _workspaces.Where(w => w.RepoName.Contains(repoName.Trim(), StringComparison.OrdinalIgnoreCase)).ToList();

        if (targetWorkspaces.Count == 0)
        {
            targetWorkspaces = _workspaces;
        }

        await Task.WhenAll(targetWorkspaces.Select(ws => EnsureRecentRemoteFetchAsync(ws, cancellationToken)));

        var matchedEntries = new List<CommitChangeEntry>();
        var fallbackLatestEntries = new List<CommitChangeEntry>();

        foreach (var ws in targetWorkspaces)
        {
            if (!GitRepository.IsValid(ws.WorkingDirectory)) continue;

            try
            {
                using var repo = new GitRepository(ws.WorkingDirectory);
                var label = !string.IsNullOrWhiteSpace(ws.RepoName)
                    ? ws.RepoName
                    : Path.GetFileName(ws.WorkingDirectory);

                var commits = CollectReachableBranchCommits(repo, ws.BranchName, 450);

                foreach (var c in commits.Take(6))
                {
                    if (!c.Parents.Skip(1).Any() || commits.Count <= 3)
                    {
                        fallbackLatestEntries.Add(BuildCommitChangeEntry(repo, label, c));
                    }
                }

                foreach (var commit in commits)
                {
                    var authorWhenBj = commit.Author.When.ToOffset(BeijingOffset);
                    var committerWhenBj = commit.Committer.When.ToOffset(BeijingOffset);
                    var inWindow = (authorWhenBj >= sinceBj && authorWhenBj <= untilBj) ||
                                   (committerWhenBj >= sinceBj && committerWhenBj <= untilBj);

                    if (!inWindow) continue;

                    if (!string.IsNullOrWhiteSpace(author) &&
                        !(commit.Author.Name?.Contains(author.Trim(), StringComparison.OrdinalIgnoreCase) == true ||
                          commit.Author.Email?.Contains(author.Trim(), StringComparison.OrdinalIgnoreCase) == true))
                    {
                        continue;
                    }

                    var entry = BuildCommitChangeEntry(repo, label, commit);
                    // Use committer time if author time was earlier (e.g. cherry-pick/rebase landed today)
                    if (authorWhenBj < sinceBj && committerWhenBj >= sinceBj && committerWhenBj <= untilBj)
                    {
                        entry = entry with { WhenBeijing = committerWhenBj };
                    }
                    matchedEntries.Add(entry);
                }
            }
            catch
            {
                // Skip invalid git repository workspace
            }
        }

        // Filter out pure merge commits if non-merge commits on the same day already explain the changes
        var nonMergeCount = matchedEntries.Count(e => !e.IsMerge);
        if (nonMergeCount > 0)
        {
            matchedEntries = matchedEntries
                .Where(e => !e.IsMerge || !e.MessageTitle.StartsWith("Merge ", StringComparison.OrdinalIgnoreCase))
                .ToList();
        }

        matchedEntries = matchedEntries
            .OrderByDescending(e => e.WhenBeijing)
            .Take(maxCommits)
            .ToList();

        var sb = new StringBuilder();
        sb.AppendLine($"### Git 代码提交与文件增改记录（查询范围：{rangeLabel}，北京时间）");

        if (matchedEntries.Count == 0)
        {
            sb.AppendLine($"- 在 [{rangeLabel}] 时间段内暂无新的 Git 代码提交记录。");

            var recentFallbacks = fallbackLatestEntries
                .OrderByDescending(e => e.WhenBeijing)
                .Take(5)
                .ToList();

            if (recentFallbacks.Count > 0)
            {
                sb.AppendLine("- 【参考：该系统最近 5 次历史代码提交记录】：");
                foreach (var fb in recentFallbacks)
                {
                    var shortSha = fb.Sha[..Math.Min(7, fb.Sha.Length)];
                    sb.AppendLine($"  * `{fb.RepoName}` | `{shortSha}` | {fb.WhenBeijing:yyyy-MM-dd HH:mm} | 提交人: {fb.AuthorName} | {fb.MessageTitle} (新增 {fb.AddedFiles.Count} 文件, 修改 {fb.ModifiedFiles.Count} 文件)");
                }
            }

            return (sb.ToString().Trim(), []);
        }

        var distinctAdded = matchedEntries.SelectMany(e => e.AddedFiles.Select(f => $"{e.RepoName}:{f}")).Distinct(StringComparer.OrdinalIgnoreCase).Count();
        var distinctModified = matchedEntries.SelectMany(e => e.ModifiedFiles.Select(f => $"{e.RepoName}:{f}")).Distinct(StringComparer.OrdinalIgnoreCase).Count();
        sb.AppendLine($"- **统计概览**：共 **{matchedEntries.Count}** 次提交，累计涉及 **新增文件 {distinctAdded} 个**、**修改文件 {distinctModified} 个**。");

        foreach (var dayGroup in matchedEntries.GroupBy(e => e.WhenBeijing.Date).OrderByDescending(g => g.Key))
        {
            var day = dayGroup.Key;
            sb.AppendLine();
            sb.AppendLine($"#### 📅 {day:yyyy-MM-dd} ({WikiChangeReportTool.FormatBeijingWeekday(day.DayOfWeek)}) — 共 {dayGroup.Count()} 次提交");

            foreach (var item in dayGroup.OrderByDescending(x => x.WhenBeijing))
            {
                var shortSha = item.Sha[..Math.Min(7, item.Sha.Length)];
                var repoPrefix = _workspaces.Count > 1 && !string.IsNullOrWhiteSpace(item.RepoName) ? $"[{item.RepoName}] " : string.Empty;
                sb.AppendLine($"- **{repoPrefix}`{shortSha}`** ({item.WhenBeijing:HH:mm:ss} | 提交人: {item.AuthorName})：{item.MessageTitle}");

                if (!string.IsNullOrWhiteSpace(item.MessageBody))
                {
                    var cleanBody = string.Join("；", item.MessageBody.Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).Take(4));
                    if (!string.IsNullOrWhiteSpace(cleanBody))
                    {
                        sb.AppendLine($"  - 详细说明：{cleanBody}");
                    }
                }

                if (item.AddedFiles.Count > 0)
                {
                    var sample = string.Join("`, `", item.AddedFiles.Take(10));
                    var more = item.AddedFiles.Count > 10 ? $" 等共 {item.AddedFiles.Count} 个新增文件" : string.Empty;
                    sb.AppendLine($"  - 🆕 新增文件 ({item.AddedFiles.Count})：`{sample}`{more}");
                }

                if (item.ModifiedFiles.Count > 0)
                {
                    var sample = string.Join("`, `", item.ModifiedFiles.Take(12));
                    var more = item.ModifiedFiles.Count > 12 ? $" 等共 {item.ModifiedFiles.Count} 个修改文件" : string.Empty;
                    sb.AppendLine($"  - ✏️ 修改文件 ({item.ModifiedFiles.Count})：`{sample}`{more}");
                }

                if (item.DeletedOrRenamedFiles.Count > 0)
                {
                    var sample = string.Join("；", item.DeletedOrRenamedFiles.Take(6));
                    var more = item.DeletedOrRenamedFiles.Count > 6 ? $" 等共 {item.DeletedOrRenamedFiles.Count} 项" : string.Empty;
                    sb.AppendLine($"  - 🗑️ 删除/重命名：{sample}{more}");
                }
            }
        }

        return (sb.ToString().Trim(), matchedEntries);
    }

    [Description(@"Reads concrete code diffs (+ added lines / - modified lines) for a specific Git commit SHA or a date (e.g., 'today', 'yesterday', '2026-11-12', or commit SHA '52cf632').

Usage:
- Call this after GetGitChanges to inspect what actual business logic, API endpoints, database fields, or UI components were added or modified, especially when commit messages are brief.")]
    public async Task<string> GetGitCommitDiffAsync(
        [Description("A commit SHA prefix (e.g. '52cf632') OR a date/keyword (e.g. 'today', 'yesterday', '2026-11-12').")]
        string commitShaOrDate,
        [Description("Optional relative file path filter to inspect a specific file's diff.")]
        string filePath = "",
        [Description("Optional sub-repository name filter.")]
        string repoName = "",
        [Description("Maximum characters of diff output to return (default: 12000, max: 24000).")]
        int maxChars = 12000,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(commitShaOrDate))
        {
            return "ERROR: commitShaOrDate cannot be empty.";
        }

        maxChars = Math.Clamp(maxChars <= 0 ? 12000 : maxChars, 1000, 24000);
        var target = commitShaOrDate.Trim();

        var targetWorkspaces = string.IsNullOrWhiteSpace(repoName)
            ? _workspaces
            : _workspaces.Where(w => w.RepoName.Contains(repoName.Trim(), StringComparison.OrdinalIgnoreCase)).ToList();
        if (targetWorkspaces.Count == 0) targetWorkspaces = _workspaces;

        await Task.WhenAll(targetWorkspaces.Select(ws => EnsureRecentRemoteFetchAsync(ws, cancellationToken)));

        var isShaCandidate = Regex.IsMatch(target, @"^[0-9a-fA-F]{6,40}$");
        var sb = new StringBuilder();
        var totalChars = 0;

        if (isShaCandidate)
        {
            foreach (var ws in targetWorkspaces)
            {
                if (!GitRepository.IsValid(ws.WorkingDirectory)) continue;
                using var repo = new GitRepository(ws.WorkingDirectory);
                var commit = repo.Lookup<Commit>(target)
                             ?? CollectReachableBranchCommits(repo, ws.BranchName, 450)
                                 .FirstOrDefault(c => c.Sha.StartsWith(target, StringComparison.OrdinalIgnoreCase));

                if (commit == null) continue;

                var label = !string.IsNullOrWhiteSpace(ws.RepoName) ? ws.RepoName : Path.GetFileName(ws.WorkingDirectory);
                AppendCommitPatchExcerpt(repo, label, commit, filePath, sb, ref totalChars, maxChars);
                if (totalChars >= maxChars) break;
            }

            return sb.Length > 0
                ? sb.ToString().Trim()
                : $"未找到提交 SHA 为 '{target}' 的代码差异记录。";
        }

        var (sinceBj, untilBj, rangeLabel) = WikiChangeReportTool.ParseBeijingDateWindow(target, target, target);
        sb.AppendLine($"### 代码变更详情 Diff 摘要（{rangeLabel}）");

        foreach (var ws in targetWorkspaces)
        {
            if (totalChars >= maxChars || !GitRepository.IsValid(ws.WorkingDirectory)) continue;
            using var repo = new GitRepository(ws.WorkingDirectory);
            var label = !string.IsNullOrWhiteSpace(ws.RepoName) ? ws.RepoName : Path.GetFileName(ws.WorkingDirectory);
            var commits = CollectReachableBranchCommits(repo, ws.BranchName, 300)
                .Where(c =>
                {
                    var aBj = c.Author.When.ToOffset(BeijingOffset);
                    var cBj = c.Committer.When.ToOffset(BeijingOffset);
                    return (aBj >= sinceBj && aBj <= untilBj) || (cBj >= sinceBj && cBj <= untilBj);
                })
                .Where(c => c.Parents.Count() <= 1)
                .Take(12)
                .ToList();

            foreach (var commit in commits)
            {
                AppendCommitPatchExcerpt(repo, label, commit, filePath, sb, ref totalChars, maxChars);
                if (totalChars >= maxChars) break;
            }
        }

        return totalChars > 0
            ? sb.ToString().Trim()
            : $"在 [{rangeLabel}] 内未找到可展示的代码 Diff。";
    }

    /// <summary>
    /// Preloads both the structured Git commit list and key business code diffs for change-history questions.
    /// </summary>
    public async Task<string> BuildPreloadedGitChangeSummaryAsync(
        string question,
        int maxDiffChars = 8500,
        CancellationToken cancellationToken = default)
    {
        var (sinceBj, untilBj, rangeLabel) = WikiChangeReportTool.ParseBeijingDateWindow(null, null, question);
        var (gitReport, matchedCommits) = await QueryGitChangesCoreAsync(
            sinceBj,
            untilBj,
            rangeLabel,
            string.Empty,
            string.Empty,
            40,
            cancellationToken);

        if (matchedCommits.Count == 0 || maxDiffChars <= 0)
        {
            return gitReport;
        }

        var diffSb = new StringBuilder();
        var diffChars = 0;

        foreach (var entry in matchedCommits.Where(c => !c.IsMerge).Take(10))
        {
            if (diffChars >= maxDiffChars) break;
            var ws = _workspaces.FirstOrDefault(w => string.Equals(w.RepoName, entry.RepoName, StringComparison.OrdinalIgnoreCase))
                     ?? _workspaces[0];
            if (!GitRepository.IsValid(ws.WorkingDirectory)) continue;

            try
            {
                using var repo = new GitRepository(ws.WorkingDirectory);
                var commit = repo.Lookup<Commit>(entry.Sha);
                if (commit != null)
                {
                    AppendCommitPatchExcerpt(repo, entry.RepoName, commit, string.Empty, diffSb, ref diffChars, maxDiffChars);
                }
            }
            catch
            {
                // Ignore single commit diff failure
            }
        }

        if (diffChars > 0)
        {
            return $"{gitReport}\n\n### 核心代码改动 Diff 摘录（供提炼业务层新增/修改点）\n{diffSb.ToString().Trim()}";
        }

        return gitReport;
    }

    private static void AppendCommitPatchExcerpt(
        GitRepository repo,
        string repoLabel,
        Commit commit,
        string fileFilter,
        StringBuilder sb,
        ref int totalChars,
        int maxChars)
    {
        try
        {
            var parentTree = commit.Parents.FirstOrDefault()?.Tree;
            using var patch = repo.Diff.Compare<Patch>(parentTree, commit.Tree);

            var entries = patch
                .Where(p => string.IsNullOrWhiteSpace(fileFilter) ||
                            p.Path.Contains(fileFilter.Trim(), StringComparison.OrdinalIgnoreCase))
                .Where(p => !IsNoisyGeneratedDiffFile(p.Path) || !string.IsNullOrWhiteSpace(fileFilter))
                .OrderByDescending(p => GetBusinessFilePriority(p.Path))
                .Take(8)
                .ToList();

            if (entries.Count == 0) return;

            var whenBj = commit.Author.When.ToOffset(BeijingOffset);
            var shortSha = commit.Sha[..Math.Min(7, commit.Sha.Length)];
            var title = (commit.MessageShort ?? string.Empty).Trim();
            var header = $"#### [{repoLabel}] `{shortSha}` ({whenBj:yyyy-MM-dd HH:mm} | {commit.Author.Name}) — {title}\n";
            sb.Append(header);
            totalChars += header.Length;

            foreach (var filePatch in entries)
            {
                if (totalChars >= maxChars) break;
                var relPath = filePatch.Path.Replace('\\', '/');
                var rawPatch = filePatch.Patch ?? string.Empty;
                if (string.IsNullOrWhiteSpace(rawPatch)) continue;

                var perFileCap = Math.Min(2200, maxChars - totalChars);
                if (perFileCap <= 120) break;

                var snippet = rawPatch.Length > perFileCap
                    ? rawPatch[..perFileCap] + "\n... [该文件后续 Diff 已省略，可调用 GetGitCommitDiff 或 ReadFile 查看完整内容]"
                    : rawPatch;

                var block = $"```diff\n// File: {relPath} ({filePatch.Status}, +{filePatch.LinesAdded}/-{filePatch.LinesDeleted})\n{snippet.TrimEnd()}\n```\n";
                sb.Append(block);
                totalChars += block.Length;
            }
        }
        catch
        {
            // Ignore patch generation errors on binary/large blobs
        }
    }

    private static bool IsNoisyGeneratedDiffFile(string path)
    {
        var fileName = Path.GetFileName(path);
        return fileName.Equals("package-lock.json", StringComparison.OrdinalIgnoreCase) ||
               fileName.Equals("pnpm-lock.yaml", StringComparison.OrdinalIgnoreCase) ||
               fileName.Equals("yarn.lock", StringComparison.OrdinalIgnoreCase) ||
               fileName.Equals("bun.lock", StringComparison.OrdinalIgnoreCase) ||
               fileName.EndsWith(".min.js", StringComparison.OrdinalIgnoreCase) ||
               fileName.EndsWith(".min.css", StringComparison.OrdinalIgnoreCase) ||
               fileName.EndsWith(".map", StringComparison.OrdinalIgnoreCase);
    }

    private static int GetBusinessFilePriority(string path)
    {
        var ext = Path.GetExtension(path).ToLowerInvariant();
        return ext switch
        {
            ".java" or ".cs" or ".py" or ".go" => 10,
            ".vue" or ".tsx" or ".ts" or ".jsx" or ".js" => 9,
            ".sql" or ".xml" => 8,
            ".yml" or ".yaml" or ".json" or ".properties" => 6,
            ".md" => 5,
            _ => 3
        };
    }

    public List<AITool> GetTools(bool includeChangeHistory = false)
    {
        var tools = new List<AITool>
        {
            AIFunctionFactory.Create(ReadAsync, new AIFunctionFactoryOptions
            {
                Name = "ReadFile"
            }),
            AIFunctionFactory.Create(ListFilesAsync, new AIFunctionFactoryOptions
            {
                Name = "ListFiles"
            }),
            AIFunctionFactory.Create(GrepAsync, new AIFunctionFactoryOptions
            {
                Name = "Grep"
            })
        };

        if (includeChangeHistory)
        {
            tools.Add(AIFunctionFactory.Create(GetGitChangesAsync, new AIFunctionFactoryOptions
            {
                Name = "GetGitChanges"
            }));
            tools.Add(AIFunctionFactory.Create(GetGitCommitDiffAsync, new AIFunctionFactoryOptions
            {
                Name = "GetGitCommitDiff"
            }));
        }

        return tools;
    }
}
