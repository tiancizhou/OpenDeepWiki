using System.Text.Json;
using System.Text.Json.Nodes;
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
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

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
                var discoveredTools = await DiscoverMcpToolsAsync(config, authorizationToken, cancellationToken);
                foreach (var discoveredTool in discoveredTools)
                {
                    var tool = CreateMcpTool(config, discoveredTool, authorizationToken, tools);
                    tools.Add(tool);
                    _logger.LogInformation("Created MCP tool: {ProviderName}/{ToolName}",
                        config.Name, discoveredTool.Name);
                }
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
    private AITool CreateMcpTool(
        McpConfig config,
        McpToolDefinition toolDefinition,
        string? authorizationToken,
        IReadOnlyCollection<AITool> existingTools)
    {
        var callMcpAsync = async (
            Dictionary<string, object?> arguments,
            CancellationToken ct) =>
        {
            return await CallMcpToolAsync(
                config,
                authorizationToken,
                toolDefinition.Name,
                arguments ?? new Dictionary<string, object?>(),
                ct);
        };

        // Create the AI function with metadata from the MCP config
        return AIFunctionFactory.Create(
            callMcpAsync,
            new AIFunctionFactoryOptions
            {
                Name = CreateUniqueToolName(SanitizeToolName(toolDefinition.Name), existingTools),
                Description = BuildToolDescription(config, toolDefinition)
            });
    }

    /// <summary>
    /// Lists tools from an MCP server using the standard JSON-RPC tools/list method.
    /// </summary>
    private async Task<List<McpToolDefinition>> DiscoverMcpToolsAsync(
        McpConfig config,
        string? authorizationToken,
        CancellationToken cancellationToken)
    {
        var responseJson = await SendMcpJsonRpcAsync(
            config,
            authorizationToken,
            "tools/list",
            new JsonObject(),
            cancellationToken);

        if (!TryGetJsonObject(responseJson, out var root))
        {
            _logger.LogError("MCP tools/list returned invalid JSON for {Name}: {Response}",
                config.Name, TrimForLog(responseJson));
            return [];
        }

        if (TryReadMcpError(root, out var errorMessage))
        {
            _logger.LogError("MCP tools/list failed for {Name}: {Error}", config.Name, errorMessage);
            return [];
        }

        if (root["result"] is not JsonObject result ||
            result["tools"] is not JsonArray toolsNode)
        {
            _logger.LogError("MCP tools/list response missing result.tools for {Name}: {Response}",
                config.Name, TrimForLog(responseJson));
            return [];
        }

        var tools = new List<McpToolDefinition>();
        foreach (var toolNode in toolsNode.OfType<JsonObject>())
        {
            var name = toolNode["name"]?.GetValue<string>();
            if (string.IsNullOrWhiteSpace(name))
            {
                continue;
            }

            tools.Add(new McpToolDefinition(
                name,
                toolNode["description"]?.GetValue<string>(),
                toolNode["inputSchema"]?.DeepClone()));
        }

        return tools;
    }

    /// <summary>
    /// Calls an MCP tool using the standard JSON-RPC tools/call method.
    /// </summary>
    private async Task<string> CallMcpToolAsync(
        McpConfig config,
        string? authorizationToken,
        string toolName,
        Dictionary<string, object?> arguments,
        CancellationToken cancellationToken)
    {
        try
        {
            var parameters = new JsonObject
            {
                ["name"] = toolName,
                ["arguments"] = JsonSerializer.SerializeToNode(arguments, JsonOptions) ?? new JsonObject()
            };

            var responseJson = await SendMcpJsonRpcAsync(
                config,
                authorizationToken,
                "tools/call",
                parameters,
                cancellationToken);

            if (!TryGetJsonObject(responseJson, out var root))
            {
                _logger.LogError("MCP tools/call returned invalid JSON for {ToolName}: {Response}",
                    toolName, TrimForLog(responseJson));
                return JsonSerializer.Serialize(new { error = true, message = "MCP调用返回了无效JSON" });
            }

            if (TryReadMcpError(root, out var errorMessage))
            {
                _logger.LogError("MCP tools/call failed for {ToolName}: {Error}", toolName, errorMessage);
                return JsonSerializer.Serialize(new { error = true, message = errorMessage });
            }

            return FormatMcpToolResult(root["result"]);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error calling MCP tool: {ProviderName}/{ToolName}", config.Name, toolName);
            return JsonSerializer.Serialize(new { error = true, message = $"MCP调用错误: {ex.Message}" });
        }
    }

    private async Task<string> SendMcpJsonRpcAsync(
        McpConfig config,
        string? authorizationToken,
        string method,
        JsonObject parameters,
        CancellationToken cancellationToken)
    {
        var httpClient = _httpClientFactory.CreateClient();
        var request = new HttpRequestMessage(HttpMethod.Post, config.ServerUrl);

        var bearerToken = NormalizeBearerToken(authorizationToken) ?? NormalizeBearerToken(config.ApiKey);
        if (!string.IsNullOrEmpty(bearerToken))
        {
            request.Headers.TryAddWithoutValidation("Authorization", $"Bearer {bearerToken}");
        }

        var body = new JsonObject
        {
            ["jsonrpc"] = "2.0",
            ["id"] = Guid.NewGuid().ToString("N"),
            ["method"] = method,
            ["params"] = parameters
        };
        request.Content = new StringContent(body.ToJsonString(JsonOptions), System.Text.Encoding.UTF8, "application/json");

        var response = await httpClient.SendAsync(request, cancellationToken);
        var responseText = await response.Content.ReadAsStringAsync(cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            _logger.LogError("MCP JSON-RPC {Method} failed: {StatusCode} - {Error}",
                method, response.StatusCode, TrimForLog(responseText));
            throw new HttpRequestException($"MCP JSON-RPC {method} failed: {response.StatusCode}");
        }

        return responseText;
    }

    private static string BuildToolDescription(McpConfig config, McpToolDefinition toolDefinition)
    {
        var parts = new List<string>();
        if (!string.IsNullOrWhiteSpace(toolDefinition.Description))
        {
            parts.Add(toolDefinition.Description.Trim());
        }
        else if (!string.IsNullOrWhiteSpace(config.Description))
        {
            parts.Add(config.Description.Trim());
        }
        else
        {
            parts.Add($"Call MCP tool: {toolDefinition.Name}");
        }

        parts.Add("Pass tool arguments as a JSON object in the `arguments` parameter.");
        if (toolDefinition.InputSchema != null)
        {
            parts.Add($"Input schema: {toolDefinition.InputSchema.ToJsonString(JsonOptions)}");
        }

        return string.Join(Environment.NewLine, parts);
    }

    private static string FormatMcpToolResult(JsonNode? result)
    {
        if (result is not JsonObject resultObject)
        {
            return result?.ToJsonString(JsonOptions) ?? "null";
        }

        if (resultObject["content"] is JsonArray content)
        {
            var textParts = new List<string>();
            foreach (var item in content.OfType<JsonObject>())
            {
                if (item["type"]?.GetValue<string>() == "text" &&
                    item["text"]?.GetValue<string>() is { } text)
                {
                    textParts.Add(text);
                }
            }

            if (textParts.Count > 0)
            {
                return string.Join(Environment.NewLine, textParts);
            }
        }

        if (resultObject["structuredContent"] != null)
        {
            return resultObject["structuredContent"]!.ToJsonString(JsonOptions);
        }

        return resultObject.ToJsonString(JsonOptions);
    }

    private static bool TryGetJsonObject(string json, out JsonObject root)
    {
        try
        {
            root = JsonNode.Parse(json) as JsonObject ?? new JsonObject();
            return root.Count > 0;
        }
        catch (JsonException)
        {
            root = new JsonObject();
            return false;
        }
    }

    private static bool TryReadMcpError(JsonObject root, out string message)
    {
        message = string.Empty;
        if (root["error"] is not JsonObject error)
        {
            return false;
        }

        message = error["message"]?.GetValue<string>() ?? error.ToJsonString(JsonOptions);
        return true;
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

    private static string CreateUniqueToolName(string baseName, IReadOnlyCollection<AITool> existingTools)
    {
        var existingNames = existingTools
            .OfType<AIFunctionDeclaration>()
            .Select(tool => tool.Name)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        if (!existingNames.Contains(baseName))
        {
            return baseName;
        }

        for (var suffix = 2; suffix < 1000; suffix++)
        {
            var candidate = $"{baseName}_{suffix}";
            if (!existingNames.Contains(candidate))
            {
                return candidate;
            }
        }

        return $"{baseName}_{Guid.NewGuid():N}"[..64];
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

    private static string TrimForLog(string text)
    {
        var trimmed = text.Trim();
        return trimmed.Length <= 1000 ? trimmed : trimmed[..1000];
    }

    private sealed record McpToolDefinition(
        string Name,
        string? Description,
        JsonNode? InputSchema);
}
