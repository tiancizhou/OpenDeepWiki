using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Serilog;

namespace OpenDeepWiki.Agents;

/// <summary>
/// 自定义 HTTP 消息处理器，用于拦截和记录请求/响应状态
/// 支持 502/429 错误自动重试
/// </summary>
public class LoggingHttpHandler(HttpMessageHandler innerHandler) : DelegatingHandler(innerHandler)
{
    private static readonly Serilog.ILogger Logger = Log.ForContext<LoggingHttpHandler>();
    private const int MaxRetryAttempts = 3;
    private static readonly TimeSpan DefaultRetryDelay = TimeSpan.FromSeconds(5);
    private static readonly TimeSpan MaxRetryDelay = TimeSpan.FromSeconds(60);

    public LoggingHttpHandler() : this(new HttpClientHandler())
    {
    }

    protected override async Task<HttpResponseMessage> SendAsync(
        HttpRequestMessage request,
        CancellationToken cancellationToken)
    {
        var requestId = Guid.NewGuid().ToString("N")[..8];
        var startTime = DateTime.UtcNow;
        var aiContext = AiExecutionScope.Current?.ToSummary() ?? "tag=unlabeled | desc=未标记AI请求";

        Logger.Information(
            "[{RequestId}] [{AiContext}] >>> Request: {Method} {RequestUri}",
            requestId,
            aiContext,
            request.Method,
            request.RequestUri);

        var attempt = 0;
        HttpResponseMessage? response = null;

        while (attempt < MaxRetryAttempts)
        {
            attempt++;

            try
            {
                // 如果是重试，需要克隆请求（因为原请求可能已被消费）
                var requestToSend = attempt == 1 ? request : await CloneRequestAsync(request);
                await ApplyProviderCompatibilityAsync(requestToSend, cancellationToken);

                response = await base.SendAsync(requestToSend, cancellationToken);

                // 检查是否需要重试
                if (ShouldRetry(response.StatusCode) && attempt < MaxRetryAttempts)
                {
                    var retryDelay = GetRetryDelay(response, attempt);
                    Logger.Warning(
                        "[{RequestId}] [{AiContext}] Retry scheduled after response. DelaySeconds: {DelaySeconds}, NextAttempt: {NextAttempt}, StatusCode: {StatusCode}",
                        requestId,
                        aiContext,
                        retryDelay.TotalSeconds,
                        attempt + 1,
                        (int)response.StatusCode);

                    response.Dispose();
                    await Task.Delay(retryDelay, cancellationToken);
                    continue;
                }

                break;
            }
            catch (Exception ex) when (attempt < MaxRetryAttempts && IsTransientException(ex))
            {
                var retryDelay = GetExponentialDelay(attempt);
                Logger.Warning(
                    ex,
                    "[{RequestId}] [{AiContext}] Transient request error, retrying. DelaySeconds: {DelaySeconds}, NextAttempt: {NextAttempt}",
                    requestId,
                    aiContext,
                    retryDelay.TotalSeconds,
                    attempt + 1);

                await Task.Delay(retryDelay, cancellationToken);
            }
            catch (Exception ex)
            {
                var elapsed = DateTime.UtcNow - startTime;
                Logger.Error(
                    ex,
                    "[{RequestId}] [{AiContext}] Request failed. DurationMs: {DurationMs}",
                    requestId,
                    aiContext,
                    elapsed.TotalMilliseconds);
                throw;
            }
        }

        var totalElapsed = DateTime.UtcNow - startTime;

        if (response != null)
        {
            Logger.Information(
                "[{RequestId}] [{AiContext}] <<< Response: {StatusCode} {StatusName} | DurationMs: {DurationMs} | Attempts: {Attempts}",
                requestId,
                aiContext,
                (int)response.StatusCode,
                response.StatusCode,
                totalElapsed.TotalMilliseconds,
                attempt);

            if (!response.IsSuccessStatusCode)
            {
                var content = await response.Content.ReadAsStringAsync(cancellationToken);
                Logger.Warning(
                    "[{RequestId}] [{AiContext}] Error response body: {ErrorBody}",
                    requestId,
                    aiContext,
                    content[..Math.Min(500, content.Length)]);
            }
        }

        return response!;
    }

    private static bool ShouldRetry(HttpStatusCode statusCode)
    {
        var i = (int)statusCode;
        if (i >= 500)
        {
            return true;
        }

        return statusCode is HttpStatusCode.BadGateway or HttpStatusCode.TooManyRequests
            or HttpStatusCode.ServiceUnavailable or HttpStatusCode.GatewayTimeout;
    }

    private static bool IsTransientException(Exception ex)
    {
        return ex is HttpRequestException or TaskCanceledException { InnerException: TimeoutException };
    }

    private static TimeSpan GetRetryDelay(HttpResponseMessage response, int attempt)
    {
        // 优先使用 Retry-After 头
        if (response.Headers.RetryAfter != null)
        {
            if (response.Headers.RetryAfter.Delta.HasValue)
            {
                var delay = response.Headers.RetryAfter.Delta.Value;
                return delay > MaxRetryDelay ? MaxRetryDelay : delay;
            }

            if (response.Headers.RetryAfter.Date.HasValue)
            {
                var delay = response.Headers.RetryAfter.Date.Value - DateTimeOffset.UtcNow;
                if (delay > TimeSpan.Zero)
                {
                    return delay > MaxRetryDelay ? MaxRetryDelay : delay;
                }
            }
        }

        // 使用指数退避
        return GetExponentialDelay(attempt);
    }

    private static TimeSpan GetExponentialDelay(int attempt)
    {
        var delay = TimeSpan.FromSeconds(Math.Pow(2, attempt - 1) * DefaultRetryDelay.TotalSeconds);
        return delay > MaxRetryDelay ? MaxRetryDelay : delay;
    }

    private static async Task<HttpRequestMessage> CloneRequestAsync(HttpRequestMessage request)
    {
        var clone = new HttpRequestMessage(request.Method, request.RequestUri)
        {
            Version = request.Version
        };

        // 复制内容
        if (request.Content != null)
        {
            var content = await request.Content.ReadAsByteArrayAsync();
            clone.Content = new ByteArrayContent(content);

            // 复制内容头
            foreach (var header in request.Content.Headers)
            {
                clone.Content.Headers.TryAddWithoutValidation(header.Key, header.Value);
            }
        }

        // 复制请求头
        foreach (var header in request.Headers)
        {
            clone.Headers.TryAddWithoutValidation(header.Key, header.Value);
        }

        // 复制选项
        foreach (var option in request.Options)
        {
            clone.Options.TryAdd(option.Key, option.Value);
        }

        return clone;
    }

    private static async Task ApplyProviderCompatibilityAsync(
        HttpRequestMessage request,
        CancellationToken cancellationToken)
    {
        if (!IsAnthropicMessagesRequest(request))
        {
            return;
        }

        if (request.Content == null)
        {
            return;
        }

        string content;
        try
        {
            content = await request.Content.ReadAsStringAsync(cancellationToken);
        }
        catch
        {
            return;
        }

        if (string.IsNullOrWhiteSpace(content))
        {
            return;
        }

        JsonNode? parsed;
        try
        {
            parsed = JsonNode.Parse(content);
        }
        catch (JsonException)
        {
            return;
        }

        if (parsed is not JsonObject body ||
            body.ContainsKey("web_fetch_requests") ||
            !IsBigModelCompatibleRequest(request, body))
        {
            return;
        }

        body["web_fetch_requests"] = new JsonArray();
        request.Content = CreatePatchedJsonContent(body, request.Content.Headers);
    }

    private static bool IsAnthropicMessagesRequest(HttpRequestMessage request)
    {
        if (request.Method != HttpMethod.Post || request.RequestUri == null)
        {
            return false;
        }

        return request.RequestUri.AbsolutePath.EndsWith("/v1/messages", StringComparison.OrdinalIgnoreCase) ||
               request.RequestUri.AbsolutePath.EndsWith("/messages", StringComparison.OrdinalIgnoreCase);
    }

    private static bool IsBigModelCompatibleRequest(HttpRequestMessage request, JsonObject body)
    {
        if (request.RequestUri?.Host.Contains("bigmodel.cn", StringComparison.OrdinalIgnoreCase) == true)
        {
            return true;
        }

        if (body["model"] is JsonValue modelValue &&
            modelValue.TryGetValue<string>(out var model) &&
            model.Trim().StartsWith("glm-", StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        return false;
    }

    private static StringContent CreatePatchedJsonContent(
        JsonObject body,
        HttpContentHeaders originalHeaders)
    {
        var patchedContent = new StringContent(body.ToJsonString(), Encoding.UTF8, "application/json");

        foreach (var header in originalHeaders)
        {
            if (header.Key.Equals("Content-Length", StringComparison.OrdinalIgnoreCase) ||
                header.Key.Equals("Content-Type", StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            patchedContent.Headers.TryAddWithoutValidation(header.Key, header.Value);
        }

        return patchedContent;
    }
}
