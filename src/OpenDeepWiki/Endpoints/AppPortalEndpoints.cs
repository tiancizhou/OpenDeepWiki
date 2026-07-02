using Microsoft.AspNetCore.Mvc;
using OpenDeepWiki.Chat.Exceptions;
using OpenDeepWiki.Services.Auth;
using OpenDeepWiki.Services.Chat;

namespace OpenDeepWiki.Endpoints;

/// <summary>
/// Authenticated portal endpoints for end users to access assigned chat apps.
/// </summary>
public static class AppPortalEndpoints
{
    public static IEndpointRouteBuilder MapAppPortalEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/v1/app-portal")
            .WithTags("应用聊天门户")
            .RequireAuthorization();

        group.MapGet("/apps", GetAccessibleAppsAsync)
            .WithName("GetAccessibleChatApps")
            .WithSummary("获取当前用户可访问的应用");

        group.MapGet("/apps/{appId}", GetAccessibleAppAsync)
            .WithName("GetAccessibleChatApp")
            .WithSummary("获取当前用户可访问的应用详情");

        group.MapPost("/stream", StreamAsync)
            .WithName("StreamPortalAppChat")
            .WithSummary("登录用户应用聊天流");

        return app;
    }

    private static async Task<IResult> GetAccessibleAppsAsync(
        [FromServices] IChatAppService chatAppService,
        [FromServices] IUserContext userContext,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrEmpty(userContext.UserId))
        {
            return Results.Unauthorized();
        }

        var apps = await chatAppService.GetAccessibleAppsAsync(userContext.UserId, cancellationToken);
        return Results.Ok(apps);
    }

    private static async Task<IResult> GetAccessibleAppAsync(
        string appId,
        [FromServices] IChatAppService chatAppService,
        [FromServices] IUserContext userContext,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrEmpty(userContext.UserId))
        {
            return Results.Unauthorized();
        }

        var app = await chatAppService.GetAccessibleAppByAppIdAsync(appId, userContext.UserId, cancellationToken);
        return app == null
            ? Results.NotFound(new { message = "应用不存在或无权访问" })
            : Results.Ok(app);
    }

    private static async Task StreamAsync(
        HttpContext httpContext,
        [FromBody] EmbedChatRequest request,
        [FromServices] IChatAppService chatAppService,
        [FromServices] IEmbedService embedService,
        [FromServices] IUserContext userContext,
        CancellationToken cancellationToken)
    {
        httpContext.Response.ContentType = "text/event-stream";
        httpContext.Response.Headers.CacheControl = "no-cache";
        httpContext.Response.Headers.Connection = "keep-alive";

        if (string.IsNullOrEmpty(userContext.UserId))
        {
            await WriteEventAsync(httpContext, SSEEventType.Error,
                SSEErrorResponse.CreateNonRetryable("UNAUTHORIZED", "请先登录"), cancellationToken);
            return;
        }

        if (string.IsNullOrWhiteSpace(request.AppId) ||
            !await chatAppService.CanUserAccessAppAsync(request.AppId, userContext.UserId, cancellationToken))
        {
            await WriteEventAsync(httpContext, SSEEventType.Error,
                SSEErrorResponse.CreateNonRetryable("APP_ACCESS_DENIED", "应用不存在或无权访问"), cancellationToken);
            return;
        }

        request.UserIdentifier = userContext.UserId;

        try
        {
            await foreach (var sseEvent in embedService.StreamEmbedChatAsync(
                               request,
                               sourceDomain: null,
                               skipDomainValidation: true,
                               cancellationToken))
            {
                await httpContext.Response.WriteAsync(FormatSSEEvent(sseEvent), cancellationToken);
                await httpContext.Response.Body.FlushAsync(cancellationToken);
            }
        }
        catch (OperationCanceledException)
        {
            // Client disconnected.
        }
        catch (Exception ex)
        {
            await WriteEventAsync(httpContext, SSEEventType.Error,
                SSEErrorResponse.CreateRetryable(ChatErrorCodes.INTERNAL_ERROR, ex.Message, 3000),
                cancellationToken);
        }
    }

    private static async Task WriteEventAsync(
        HttpContext httpContext,
        string type,
        object data,
        CancellationToken cancellationToken)
    {
        await httpContext.Response.WriteAsync(FormatSSEEvent(new SSEEvent
        {
            Type = type,
            Data = data
        }), cancellationToken);
        await httpContext.Response.Body.FlushAsync(cancellationToken);
    }

    private static string FormatSSEEvent(SSEEvent sseEvent)
    {
        var payload = System.Text.Json.JsonSerializer.Serialize(new
        {
            type = sseEvent.Type,
            data = sseEvent.Data
        }, new System.Text.Json.JsonSerializerOptions
        {
            PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase
        });

        return $"event: {sseEvent.Type}\ndata: {payload}\n\n";
    }
}
