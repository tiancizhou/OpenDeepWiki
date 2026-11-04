using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using Microsoft.EntityFrameworkCore;
using OpenDeepWiki.EFCore;

namespace OpenDeepWiki.Services.Auth;

/// <summary>
/// 统一 API Key 认证中间件
/// 支持通过请求头 X-API-Key: dwk_xxx、Authorization: Bearer dwk_xxx 或查询参数 ?api_key=dwk_xxx 进行认证。
/// 认证成功后构造标准 ClaimsPrincipal，使 IUserContext、RequireAuthorization、OpenAPI 与 MCP 端点无缝共享同一套身份体系。
/// </summary>
public class ApiKeyAuthenticationMiddleware
{
    public const string KeyPrefix = "dwk_";
    public const string HeaderName = "X-API-Key";
    public const string AuthenticationScheme = "ApiKey";

    private readonly RequestDelegate _next;
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<ApiKeyAuthenticationMiddleware> _logger;

    public ApiKeyAuthenticationMiddleware(
        RequestDelegate next,
        IServiceScopeFactory scopeFactory,
        ILogger<ApiKeyAuthenticationMiddleware> logger)
    {
        _next = next;
        _scopeFactory = scopeFactory;
        _logger = logger;
    }

    public async Task InvokeAsync(HttpContext context)
    {
        var rawKey = ExtractApiKey(context.Request);
        if (!string.IsNullOrWhiteSpace(rawKey))
        {
            await TryAuthenticateWithApiKeyAsync(context, rawKey);
        }

        await _next(context);
    }

    public static string? ExtractApiKey(HttpRequest request)
    {
        if (request.Headers.TryGetValue(HeaderName, out var apiKeyHeader))
        {
            var headerValue = apiKeyHeader.FirstOrDefault()?.Trim();
            if (!string.IsNullOrWhiteSpace(headerValue) &&
                headerValue.StartsWith(KeyPrefix, StringComparison.Ordinal))
            {
                return headerValue;
            }
        }

        if (request.Headers.TryGetValue("Authorization", out var authHeader))
        {
            var authValue = authHeader.FirstOrDefault()?.Trim();
            if (!string.IsNullOrWhiteSpace(authValue) &&
                authValue.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
            {
                var token = authValue["Bearer ".Length..].Trim();
                if (token.StartsWith(KeyPrefix, StringComparison.Ordinal))
                {
                    return token;
                }
            }
        }

        if (request.Query.TryGetValue("api_key", out var queryKey))
        {
            var queryValue = queryKey.FirstOrDefault()?.Trim();
            if (!string.IsNullOrWhiteSpace(queryValue) &&
                queryValue.StartsWith(KeyPrefix, StringComparison.Ordinal))
            {
                return queryValue;
            }
        }

        return null;
    }

    private async Task TryAuthenticateWithApiKeyAsync(HttpContext httpContext, string rawKey)
    {
        try
        {
            var hashBytes = SHA256.HashData(Encoding.UTF8.GetBytes(rawKey));
            var hashHex = Convert.ToHexString(hashBytes).ToLowerInvariant();

            var dbContext = httpContext.RequestServices.GetRequiredService<IContext>();
            var apiKey = await dbContext.ApiKeys
                .AsNoTracking()
                .Include(k => k.User)
                .FirstOrDefaultAsync(k => k.KeyHash == hashHex && !k.IsDeleted, httpContext.RequestAborted);

            if (apiKey == null)
            {
                _logger.LogWarning("Invalid API key presented from IP {Ip}", httpContext.Connection.RemoteIpAddress);
                return;
            }

            if (apiKey.ExpiresAt.HasValue && apiKey.ExpiresAt.Value <= DateTime.UtcNow)
            {
                _logger.LogWarning("Expired API key used: id={KeyId}, prefix={Prefix}", apiKey.Id, apiKey.KeyPrefix);
                return;
            }

            if (apiKey.User == null || apiKey.User.IsDeleted)
            {
                _logger.LogWarning("API key owner missing or deleted: id={KeyId}, userId={UserId}", apiKey.Id, apiKey.UserId);
                return;
            }

            var roles = await dbContext.UserRoles
                .AsNoTracking()
                .Where(ur => ur.UserId == apiKey.UserId && !ur.IsDeleted)
                .Join(
                    dbContext.Roles.AsNoTracking().Where(r => !r.IsDeleted),
                    ur => ur.RoleId,
                    r => r.Id,
                    (_, r) => r.Name)
                .ToListAsync(httpContext.RequestAborted);

            var claims = new List<Claim>
            {
                new(ClaimTypes.NameIdentifier, apiKey.User.Id),
                new(ClaimTypes.Name, apiKey.User.Name),
                new(ClaimTypes.Email, apiKey.User.Email ?? string.Empty),
                new("auth_type", "api_key"),
                new("api_key_id", apiKey.Id),
                new("api_key_name", apiKey.Name),
                new("api_key_prefix", apiKey.KeyPrefix)
            };

            foreach (var role in roles.Distinct(StringComparer.OrdinalIgnoreCase))
            {
                claims.Add(new Claim(ClaimTypes.Role, role));
            }

            var scopes = ParseScopes(apiKey.Scope);
            foreach (var scope in scopes)
            {
                claims.Add(new Claim("scope", scope));
            }

            var identity = new ClaimsIdentity(claims, AuthenticationScheme);
            httpContext.User = new ClaimsPrincipal(identity);

            // Throttle LastUsedAt writes to at most once per minute per key
            if (!apiKey.LastUsedAt.HasValue || (DateTime.UtcNow - apiKey.LastUsedAt.Value) > TimeSpan.FromMinutes(1))
            {
                var keyId = apiKey.Id;
                _ = Task.Run(async () =>
                {
                    try
                    {
                        using var scope = _scopeFactory.CreateScope();
                        var scopedContext = scope.ServiceProvider.GetRequiredService<IContext>();
                        var entity = await scopedContext.ApiKeys.FirstOrDefaultAsync(k => k.Id == keyId && !k.IsDeleted);
                        if (entity != null)
                        {
                            entity.LastUsedAt = DateTime.UtcNow;
                            await scopedContext.SaveChangesAsync();
                        }
                    }
                    catch
                    {
                        // Ignore background timestamp update failures
                    }
                });
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error occurred while validating API key");
        }
    }

    public static IReadOnlyList<string> ParseScopes(string? rawScope)
    {
        if (string.IsNullOrWhiteSpace(rawScope))
        {
            return ["mcp:read", "open:read"];
        }

        return rawScope
            .Split([',', ' ', ';'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
    }
}

public static class ApiKeyAuthenticationExtensions
{
    public static IApplicationBuilder UseApiKeyAuthentication(this IApplicationBuilder app)
    {
        return app.UseMiddleware<ApiKeyAuthenticationMiddleware>();
    }

    /// <summary>
    /// 校验当前用户是否具备指定的开放平台 Scope。
    /// 若通过常规 JWT 登录则默认放行；若通过 API Key 访问则校验其 Scope 列表。
    /// </summary>
    public static bool HasApiKeyScope(this ClaimsPrincipal? principal, string requiredScope)
    {
        if (principal?.Identity?.IsAuthenticated != true)
        {
            return false;
        }

        var authType = principal.FindFirstValue("auth_type");
        if (!string.Equals(authType, "api_key", StringComparison.OrdinalIgnoreCase))
        {
            // Standard JWT authenticated user
            return true;
        }

        var scopes = principal.FindAll("scope")
            .Select(c => c.Value)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        if (scopes.Contains("*") || scopes.Contains("all") || scopes.Contains("open:all"))
        {
            return true;
        }

        if (scopes.Contains(requiredScope))
        {
            return true;
        }

        // Backward compatibility: keys created with default "mcp:read" can also read open knowledge endpoints
        if (string.Equals(requiredScope, "open:read", StringComparison.OrdinalIgnoreCase) &&
            scopes.Contains("mcp:read"))
        {
            return true;
        }

        if (string.Equals(requiredScope, "open:chat", StringComparison.OrdinalIgnoreCase) &&
            (scopes.Contains("mcp:read") || scopes.Contains("open:read")))
        {
            return true;
        }

        return false;
    }
}
