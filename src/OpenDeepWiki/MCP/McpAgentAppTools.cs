using System.ComponentModel;
using System.Text.Json;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using ModelContextProtocol.Server;
using OpenDeepWiki.EFCore;
using OpenDeepWiki.Endpoints;

namespace OpenDeepWiki.MCP;

/// <summary>
/// 面向「智能体应用 (ChatApp)」的 MCP 工具集。
/// 支持通过全局 /api/mcp 或单应用专属端点 /api/mcp/app/{appId} 调用，
/// 彻底屏蔽底层 Git 代码仓库细节，直接与封装好的业务智能体应用交互。
/// </summary>
[McpServerToolType]
public class McpAgentAppTools
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = false
    };

    [McpServerTool, Description("列出 OpenDeepWiki 中所有可用的智能体应用（业务系统知识库）。无需关心底层代码仓库，直接按智能体应用名称或 appId 进行问答。")]
    public static async Task<string> ListAgentApps(
        IContext context,
        IHttpContextAccessor httpContextAccessor,
        [Description("可选关键字，按智能体应用名称、描述或业务分组过滤")] string? query = null,
        CancellationToken cancellationToken = default)
    {
        var scopedAppId = ResolveScopedAppId(httpContextAccessor.HttpContext);
        var projects = await ZtWorkEndpoints.GetAgentProjectsForMcpAsync(context, scopedAppId, query, cancellationToken);
        return JsonSerializer.Serialize(new
        {
            count = projects.Count,
            apps = projects
        }, JsonOptions);
    }

    [McpServerTool, Description("向指定的智能体应用（业务系统）提问。智能体将自动检索其挂载的前后端知识库文档，判断相关性并给出完整方案与引用来源。")]
    public static async Task<string> AskAgentApp(
        IServiceProvider serviceProvider,
        IContext context,
        IHttpContextAccessor httpContextAccessor,
        [Description("要提问的问题描述，例如：'我需要一个南通机物料的预到货单接口，给我一个方案'")] string question,
        [Description("目标智能体应用的 appId 或名称（如 '南通机物料'、'mqg'）。若通过专属 /api/mcp/app/{appId} 接入可留空。")] string? appIdOrName = null,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(question))
        {
            return JsonSerializer.Serialize(new { error = true, message = "question 不能为空" }, JsonOptions);
        }

        var targetApp = !string.IsNullOrWhiteSpace(appIdOrName)
            ? appIdOrName.Trim()
            : ResolveScopedAppId(httpContextAccessor.HttpContext);

        var result = await ZtWorkEndpoints.ExecuteMcpAgentAskAsync(
            serviceProvider,
            context,
            httpContextAccessor.HttpContext,
            targetApp,
            question.Trim(),
            cancellationToken);

        return JsonSerializer.Serialize(result, JsonOptions);
    }

    private static string? ResolveScopedAppId(HttpContext? httpContext)
    {
        if (httpContext == null) return null;
        var segments = httpContext.Request.Path.Value?.Split('/', StringSplitOptions.RemoveEmptyEntries) ?? [];
        // 匹配 /api/mcp/app/{appId}
        if (segments.Length >= 4 &&
            string.Equals(segments[0], "api", StringComparison.OrdinalIgnoreCase) &&
            string.Equals(segments[1], "mcp", StringComparison.OrdinalIgnoreCase) &&
            string.Equals(segments[2], "app", StringComparison.OrdinalIgnoreCase))
        {
            return Uri.UnescapeDataString(segments[3]);
        }

        if (httpContext.Request.Query.TryGetValue("appId", out var qApp) && !string.IsNullOrWhiteSpace(qApp))
        {
            return qApp.ToString().Trim();
        }

        return null;
    }
}
