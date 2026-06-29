using System.ComponentModel;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.AI;
using OpenDeepWiki.EFCore;
using OpenDeepWiki.Entities;

namespace OpenDeepWiki.Services.Chat;

/// <summary>
/// Interface for converting MCP configurations to AI tools.
/// </summary>
public interface IMcpToolConverter
{
    /// <summary>
    /// Converts MCP configurations to AI tools.
    /// </summary>
    /// <param name="mcpIds">List of MCP configuration IDs to convert.</param>
    /// <param name="authorizationToken">Optional per-session bearer token forwarded to MCP servers.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>List of AI tools created from MCP configurations.</returns>
    Task<List<AITool>> ConvertMcpConfigsToToolsAsync(
        List<string> mcpIds,
        string? authorizationToken = null,
        CancellationToken cancellationToken = default);
}

/// <summary>
/// Converts MCP configurations to AI tools that can be used by the chat assistant.
/// </summary>
public class McpToolConverter : IMcpToolConverter
{
    private readonly IContext _context;
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly ILogger<McpToolConverter> _logger;

    public McpToolConverter(
        IContext context,
        IHttpClientFactory httpClientFactory,
        ILogger<McpToolConverter> logger)
    {
        _context = context;
        _httpClientFactory = httpClientFactory;
        _logger = logger;
    }

    /// <inheritdoc />
    public async Task<List<AITool>> ConvertMcpConfigsToToolsAsync(
        List<string> mcpIds,
        string? authorizationToken = null,
        CancellationToken cancellationToken = default)
    {
        var tools = new List<AITool>();

        if (mcpIds == null || mcpIds.Count == 0)
        {
            return tools;
        }

        // Load MCP configurations from database
        var mcpConfigs = await _context.McpConfigs
            .Where(m => mcpIds.Contains(m.Id) && m.IsActive && !m.IsDeleted)
            .ToListAsync(cancellationToken);

        foreach (var config in mcpConfigs)
        {
            try
            {
                var tool = CreateMcpTool(config, authorizationToken);
                tools.Add(tool);
                _logger.LogInformation("Created MCP tool: {Name}", config.Name);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to create MCP tool for config: {Name}", config.Name);
            }
        }

        return tools;
    }

    /// <summary>
    /// Creates an AI tool from an MCP configuration.
    /// </summary>
    private AITool CreateMcpTool(McpConfig config, string? authorizationToken)
    {
        // Create a wrapper function that calls the MCP server
        var callMcpAsync = async (string input, CancellationToken ct) =>
        {
            return await CallMcpServerAsync(config, authorizationToken, input, ct);
        };

        // Create the AI function with metadata from the MCP config
        return AIFunctionFactory.Create(
            callMcpAsync,
            new AIFunctionFactoryOptions
            {
                Name = SanitizeToolName(config.Name),
                Description = config.Description ?? $"Call MCP server: {config.Name}"
            });
    }

    /// <summary>
    /// Calls the MCP server with the given input.
    /// </summary>
    private async Task<string> CallMcpServerAsync(
        McpConfig config,
        string? authorizationToken,
        string input,
        CancellationToken cancellationToken)
    {
        try
        {
            var httpClient = _httpClientFactory.CreateClient();
            
            // Set up the request
            var request = new HttpRequestMessage(HttpMethod.Post, config.ServerUrl);
            
            var bearerToken = NormalizeBearerToken(authorizationToken) ?? NormalizeBearerToken(config.ApiKey);
            if (!string.IsNullOrEmpty(bearerToken))
            {
                request.Headers.TryAddWithoutValidation("Authorization", $"Bearer {bearerToken}");
            }

            // Set the request body
            request.Content = JsonContent.Create(new { input });

            // Send the request
            var response = await httpClient.SendAsync(request, cancellationToken);
            
            if (!response.IsSuccessStatusCode)
            {
                var errorContent = await response.Content.ReadAsStringAsync(cancellationToken);
                _logger.LogError("MCP call failed: {StatusCode} - {Error}", response.StatusCode, errorContent);
                return JsonSerializer.Serialize(new { error = true, message = $"MCP调用失败: {response.StatusCode}" });
            }

            var result = await response.Content.ReadAsStringAsync(cancellationToken);
            return result;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error calling MCP server: {Name}", config.Name);
            return JsonSerializer.Serialize(new { error = true, message = $"MCP调用错误: {ex.Message}" });
        }
    }

    /// <summary>
    /// Sanitizes the tool name to match OpenAI-compatible tool name requirements.
    /// </summary>
    private static string SanitizeToolName(string name)
    {
        var chars = name
            .Select(c => IsAsciiToolNameChar(c) ? c : '_')
            .ToArray();

        var sanitized = new string(chars).Trim('_', '-');
        while (sanitized.Contains("__", StringComparison.Ordinal))
        {
            sanitized = sanitized.Replace("__", "_", StringComparison.Ordinal);
        }

        if (string.IsNullOrWhiteSpace(sanitized))
        {
            sanitized = "mcp_tool";
        }

        if (sanitized.Length > 64)
        {
            sanitized = sanitized[..64].Trim('_', '-');
        }

        return sanitized;
    }

    private static bool IsAsciiToolNameChar(char c)
    {
        return c is >= 'a' and <= 'z'
            or >= 'A' and <= 'Z'
            or >= '0' and <= '9'
            or '_'
            or '-';
    }

    private static string? NormalizeBearerToken(string? token)
    {
        if (string.IsNullOrWhiteSpace(token))
        {
            return null;
        }

        var normalized = token.Trim();
        if (normalized.Contains('\r') || normalized.Contains('\n'))
        {
            return null;
        }

        const string bearerPrefix = "Bearer ";
        return normalized.StartsWith(bearerPrefix, StringComparison.OrdinalIgnoreCase)
            ? normalized[bearerPrefix.Length..].Trim()
            : normalized;
    }
}
