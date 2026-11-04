using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using OpenDeepWiki.EFCore;
using OpenDeepWiki.Entities;
using OpenDeepWiki.Services.AI;

namespace OpenDeepWiki.Services.Chat;

/// <summary>
/// 智能体应用绑定的仓库简要信息
/// </summary>
public class ChatAppBoundRepoDto
{
    public string Id { get; set; } = string.Empty;
    public string OrgName { get; set; } = string.Empty;
    public string RepoName { get; set; } = string.Empty;
    public string? Description { get; set; }
    public string StatusName { get; set; } = string.Empty;
    public bool IsPublic { get; set; }
}

/// <summary>
/// DTO for creating a chat app.
/// </summary>
public class CreateChatAppDto
{
    public string Name { get; set; } = string.Empty;
    public string? Description { get; set; }
    public string? IconUrl { get; set; }
    public bool EnableDomainValidation { get; set; }
    public List<string>? AllowedDomains { get; set; }
    public string? AiProviderId { get; set; }
    public string ProviderType { get; set; } = "OpenAI";
    public string? ApiKey { get; set; }
    public string? BaseUrl { get; set; }
    public List<string>? AvailableModels { get; set; }
    public string? DefaultModel { get; set; }
    public int? RateLimitPerMinute { get; set; }
    public string? GroupName { get; set; }
    public List<string>? RepositoryIds { get; set; }
    public string? SystemPrompt { get; set; }
    public bool IsPublic { get; set; } = true;
    public string? AllowedEmployeeNos { get; set; }
}

/// <summary>
/// DTO for updating a chat app.
/// </summary>
public class UpdateChatAppDto
{
    public string? Name { get; set; }
    public string? Description { get; set; }
    public string? IconUrl { get; set; }
    public bool? EnableDomainValidation { get; set; }
    public List<string>? AllowedDomains { get; set; }
    public string? AiProviderId { get; set; }
    public string? ProviderType { get; set; }
    public string? ApiKey { get; set; }
    public string? BaseUrl { get; set; }
    public List<string>? AvailableModels { get; set; }
    public string? DefaultModel { get; set; }
    public int? RateLimitPerMinute { get; set; }
    public bool? IsActive { get; set; }
    public string? GroupName { get; set; }
    public List<string>? RepositoryIds { get; set; }
    public string? SystemPrompt { get; set; }
    public bool? IsPublic { get; set; }
    public string? AllowedEmployeeNos { get; set; }
}

/// <summary>
/// DTO for chat app response.
/// </summary>
public class ChatAppDto
{
    public Guid Id { get; set; }
    public string UserId { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string? Description { get; set; }
    public string? IconUrl { get; set; }
    public string AppId { get; set; } = string.Empty;
    public string? AppSecret { get; set; }
    public bool EnableDomainValidation { get; set; }
    public List<string> AllowedDomains { get; set; } = new();
    public string? AiProviderId { get; set; }
    public string ProviderType { get; set; } = string.Empty;
    public string? ApiKey { get; set; }
    public string? BaseUrl { get; set; }
    public List<string> AvailableModels { get; set; } = new();
    public string? DefaultModel { get; set; }
    public int? RateLimitPerMinute { get; set; }
    public bool IsActive { get; set; }
    public string? GroupName { get; set; }
    public List<string> RepositoryIds { get; set; } = new();
    public List<ChatAppBoundRepoDto> BoundRepositories { get; set; } = new();
    public string? SystemPrompt { get; set; }
    public bool IsPublic { get; set; } = true;
    public string? AllowedEmployeeNos { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime? UpdatedAt { get; set; }
}

/// <summary>
/// Interface for chat app service.
/// </summary>
public interface IChatAppService
{
    Task<ChatAppDto> CreateAppAsync(string userId, CreateChatAppDto dto, CancellationToken cancellationToken = default);
    Task<List<ChatAppDto>> GetUserAppsAsync(string userId, CancellationToken cancellationToken = default);
    Task<ChatAppDto?> GetAppByIdAsync(Guid id, string userId, CancellationToken cancellationToken = default);
    Task<ChatAppDto?> GetAppByAppIdAsync(string appId, CancellationToken cancellationToken = default);
    Task<ChatAppDto?> UpdateAppAsync(Guid id, string userId, UpdateChatAppDto dto, CancellationToken cancellationToken = default);
    Task<bool> DeleteAppAsync(Guid id, string userId, CancellationToken cancellationToken = default);
    Task<string?> RegenerateSecretAsync(Guid id, string userId, CancellationToken cancellationToken = default);
    string GenerateAppId();
    string GenerateAppSecret();
}

/// <summary>
/// Chat app service implementation.
/// </summary>
public class ChatAppService : IChatAppService
{
    private readonly IContext _context;
    private readonly ILogger<ChatAppService> _logger;

    public ChatAppService(IContext context, ILogger<ChatAppService> logger)
    {
        _context = context;
        _logger = logger;
    }

    /// <inheritdoc />
    public async Task<ChatAppDto> CreateAppAsync(string userId, CreateChatAppDto dto, CancellationToken cancellationToken = default)
    {
        var aiProviderId = dto.AiProviderId;
        var defaultModel = dto.DefaultModel;
        var providerType = string.IsNullOrWhiteSpace(dto.ProviderType) ? "OpenAI" : dto.ProviderType;

        if (string.IsNullOrWhiteSpace(aiProviderId))
        {
            aiProviderId = await CreateProviderFromLegacyAppConfigAsync(
                dto.Name,
                dto.ProviderType,
                dto.BaseUrl,
                dto.ApiKey,
                dto.DefaultModel ?? dto.AvailableModels?.FirstOrDefault(),
                cancellationToken);
        }

        if (string.IsNullOrWhiteSpace(aiProviderId))
        {
            var defaultProvider = await _context.AiProviderConfigs
                .AsNoTracking()
                .Where(p => p.IsActive && !p.IsDeleted)
                .OrderBy(p => p.SortOrder)
                .FirstOrDefaultAsync(cancellationToken);

            if (defaultProvider != null)
            {
                aiProviderId = defaultProvider.Id;
                providerType = defaultProvider.ProviderType;
                if (string.IsNullOrWhiteSpace(defaultModel))
                {
                    defaultModel = defaultProvider.DefaultModelId;
                }
            }
        }

        var normalizedRepoIds = (dto.RepositoryIds ?? [])
            .Where(x => !string.IsNullOrWhiteSpace(x))
            .Select(x => x.Trim())
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        var app = new ChatApp
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            Name = dto.Name.Trim(),
            Description = dto.Description?.Trim(),
            IconUrl = dto.IconUrl?.Trim(),
            AppId = GenerateAppId(),
            AppSecret = GenerateAppSecret(),
            EnableDomainValidation = dto.EnableDomainValidation,
            AllowedDomains = dto.AllowedDomains != null ? JsonSerializer.Serialize(dto.AllowedDomains) : null,
            AiProviderId = aiProviderId,
            ProviderType = providerType,
            ApiKey = dto.ApiKey,
            BaseUrl = dto.BaseUrl,
            AvailableModels = dto.AvailableModels != null ? JsonSerializer.Serialize(dto.AvailableModels) : null,
            DefaultModel = defaultModel,
            RateLimitPerMinute = dto.RateLimitPerMinute,
            IsActive = true,
            GroupName = string.IsNullOrWhiteSpace(dto.GroupName) ? "业务系统智能体" : dto.GroupName.Trim(),
            RepositoryIds = JsonSerializer.Serialize(normalizedRepoIds),
            SystemPrompt = dto.SystemPrompt?.Trim(),
            IsPublic = dto.IsPublic,
            AllowedEmployeeNos = NormalizeEmployeeNos(dto.AllowedEmployeeNos),
            CreatedAt = DateTime.UtcNow
        };

        _context.ChatApps.Add(app);
        await _context.SaveChangesAsync(cancellationToken);

        _logger.LogInformation("Created chat app {AppId} ({Name}) with {RepoCount} bound repos for user {UserId}",
            app.AppId, app.Name, normalizedRepoIds.Count, userId);

        var repoMap = await LoadRepositoryMapAsync(cancellationToken);
        return MapToDto(app, includeSecret: true, repoMap);
    }

    /// <inheritdoc />
    public async Task<List<ChatAppDto>> GetUserAppsAsync(string userId, CancellationToken cancellationToken = default)
    {
        await EnsureDefaultBusinessSystemAppsAsync(userId, cancellationToken);

        // 企业内部知识中枢：所有登录研发/管理员均可查看已创建的智能体应用列表
        var apps = await _context.ChatApps
            .Where(a => !a.IsDeleted)
            .OrderByDescending(a => a.CreatedAt)
            .ToListAsync(cancellationToken);

        var repoMap = await LoadRepositoryMapAsync(cancellationToken);
        return apps.Select(a => MapToDto(a, includeSecret: false, repoMap)).ToList();
    }

    /// <inheritdoc />
    public async Task<ChatAppDto?> GetAppByIdAsync(Guid id, string userId, CancellationToken cancellationToken = default)
    {
        var app = await _context.ChatApps
            .FirstOrDefaultAsync(a => a.Id == id && !a.IsDeleted, cancellationToken);

        if (app == null) return null;
        var repoMap = await LoadRepositoryMapAsync(cancellationToken);
        return MapToDto(app, includeSecret: true, repoMap);
    }

    /// <inheritdoc />
    public async Task<ChatAppDto?> GetAppByAppIdAsync(string appId, CancellationToken cancellationToken = default)
    {
        var app = await _context.ChatApps
            .FirstOrDefaultAsync(a => a.AppId == appId && !a.IsDeleted, cancellationToken);

        if (app == null) return null;
        var repoMap = await LoadRepositoryMapAsync(cancellationToken);
        return MapToDto(app, includeSecret: false, repoMap);
    }

    /// <inheritdoc />
    public async Task<ChatAppDto?> UpdateAppAsync(Guid id, string userId, UpdateChatAppDto dto, CancellationToken cancellationToken = default)
    {
        var app = await _context.ChatApps
            .FirstOrDefaultAsync(a => a.Id == id && !a.IsDeleted, cancellationToken);

        if (app == null)
        {
            return null;
        }

        if (dto.Name != null) app.Name = dto.Name.Trim();
        if (dto.Description != null) app.Description = dto.Description.Trim();
        if (dto.IconUrl != null) app.IconUrl = dto.IconUrl.Trim();
        if (dto.EnableDomainValidation.HasValue) app.EnableDomainValidation = dto.EnableDomainValidation.Value;
        if (dto.AllowedDomains != null) app.AllowedDomains = JsonSerializer.Serialize(dto.AllowedDomains);
        if (dto.AiProviderId != null) app.AiProviderId = dto.AiProviderId;
        else if (string.IsNullOrWhiteSpace(app.AiProviderId) &&
                 (dto.ApiKey != null || dto.BaseUrl != null || dto.ProviderType != null))
        {
            app.AiProviderId = await CreateProviderFromLegacyAppConfigAsync(
                app.Name,
                dto.ProviderType ?? app.ProviderType,
                dto.BaseUrl ?? app.BaseUrl,
                dto.ApiKey ?? app.ApiKey,
                dto.DefaultModel ?? app.DefaultModel,
                cancellationToken);
        }
        if (dto.ProviderType != null) app.ProviderType = dto.ProviderType;
        if (dto.ApiKey != null) app.ApiKey = dto.ApiKey;
        if (dto.BaseUrl != null) app.BaseUrl = dto.BaseUrl;
        if (dto.AvailableModels != null) app.AvailableModels = JsonSerializer.Serialize(dto.AvailableModels);
        if (dto.DefaultModel != null) app.DefaultModel = dto.DefaultModel;
        if (dto.RateLimitPerMinute.HasValue) app.RateLimitPerMinute = dto.RateLimitPerMinute;
        if (dto.IsActive.HasValue) app.IsActive = dto.IsActive.Value;
        if (dto.GroupName != null) app.GroupName = string.IsNullOrWhiteSpace(dto.GroupName) ? "业务系统智能体" : dto.GroupName.Trim();
        if (dto.RepositoryIds != null)
        {
            var normalizedRepoIds = dto.RepositoryIds
                .Where(x => !string.IsNullOrWhiteSpace(x))
                .Select(x => x.Trim())
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();
            app.RepositoryIds = JsonSerializer.Serialize(normalizedRepoIds);
        }
        if (dto.SystemPrompt != null) app.SystemPrompt = dto.SystemPrompt.Trim();
        if (dto.IsPublic.HasValue) app.IsPublic = dto.IsPublic.Value;
        if (dto.AllowedEmployeeNos != null) app.AllowedEmployeeNos = NormalizeEmployeeNos(dto.AllowedEmployeeNos);

        app.UpdatedAt = DateTime.UtcNow;

        await _context.SaveChangesAsync(cancellationToken);

        _logger.LogInformation("Updated chat app {AppId} ({Name})", app.AppId, app.Name);

        var repoMap = await LoadRepositoryMapAsync(cancellationToken);
        return MapToDto(app, includeSecret: true, repoMap);
    }

    /// <inheritdoc />
    public async Task<bool> DeleteAppAsync(Guid id, string userId, CancellationToken cancellationToken = default)
    {
        var app = await _context.ChatApps
            .FirstOrDefaultAsync(a => a.Id == id && !a.IsDeleted, cancellationToken);

        if (app == null)
        {
            return false;
        }

        app.IsDeleted = true;
        app.UpdatedAt = DateTime.UtcNow;

        await _context.SaveChangesAsync(cancellationToken);

        _logger.LogInformation("Deleted chat app {AppId}", app.AppId);

        return true;
    }

    /// <inheritdoc />
    public async Task<string?> RegenerateSecretAsync(Guid id, string userId, CancellationToken cancellationToken = default)
    {
        var app = await _context.ChatApps
            .FirstOrDefaultAsync(a => a.Id == id && !a.IsDeleted, cancellationToken);

        if (app == null)
        {
            return null;
        }

        app.AppSecret = GenerateAppSecret();
        app.UpdatedAt = DateTime.UtcNow;

        await _context.SaveChangesAsync(cancellationToken);

        _logger.LogInformation("Regenerated secret for chat app {AppId}", app.AppId);

        return app.AppSecret;
    }

    /// <inheritdoc />
    public string GenerateAppId()
    {
        var bytes = new byte[12];
        RandomNumberGenerator.Fill(bytes);
        return $"app_{Convert.ToHexString(bytes).ToLowerInvariant()}";
    }

    /// <inheritdoc />
    public string GenerateAppSecret()
    {
        var bytes = new byte[24];
        RandomNumberGenerator.Fill(bytes);
        return $"sk_{Convert.ToHexString(bytes).ToLowerInvariant()}";
    }

    /// <summary>
    /// 自动将现有的业务系统仓库组（如“南通机物料”、“mqg”）初始化为智能体应用（若尚未创建）
    /// </summary>
    private async Task EnsureDefaultBusinessSystemAppsAsync(string fallbackUserId, CancellationToken cancellationToken)
    {
        var existingApps = await _context.ChatApps
            .AsNoTracking()
            .Where(a => !a.IsDeleted)
            .ToListAsync(cancellationToken);

        if (existingApps.Count > 0)
        {
            return;
        }

        var repos = await _context.Repositories
            .AsNoTracking()
            .Where(r => !r.IsDeleted)
            .OrderBy(r => r.CreatedAt)
            .ToListAsync(cancellationToken);

        if (repos.Count == 0)
        {
            return;
        }

        var defaultProvider = await _context.AiProviderConfigs
            .AsNoTracking()
            .Where(p => p.IsActive && !p.IsDeleted)
            .OrderBy(p => p.SortOrder)
            .FirstOrDefaultAsync(cancellationToken);

        var defaultModel = defaultProvider?.DefaultModelId;
        if (string.IsNullOrWhiteSpace(defaultModel) && defaultProvider != null)
        {
            defaultModel = await _context.AiModelConfigs
                .AsNoTracking()
                .Where(m => m.ProviderId == defaultProvider.Id && m.IsActive && !m.IsDeleted)
                .OrderByDescending(m => m.IsDefault)
                .Select(m => m.ModelId)
                .FirstOrDefaultAsync(cancellationToken);
        }

        var groupedByOrg = repos.GroupBy(r => r.OrgName, StringComparer.OrdinalIgnoreCase);
        foreach (var group in groupedByOrg)
        {
            var items = group.ToList();
            var systemName = items[0].OrgName;
            var repoIds = items.Select(r => r.Id).ToList();
            var subNames = string.Join(" + ", items.Select(r => r.RepoName));
            var description = items.Select(r => r.Description).FirstOrDefault(d => !string.IsNullOrWhiteSpace(d))
                              ?? $"「{systemName}」业务系统智能体（已联合挂载 {subNames} 知识库，对外提供统一问答与接口方案设计）";

            var app = new ChatApp
            {
                Id = Guid.NewGuid(),
                UserId = items[0].OwnerUserId ?? fallbackUserId,
                Name = systemName,
                Description = description,
                AppId = GenerateAppId(),
                AppSecret = GenerateAppSecret(),
                AiProviderId = defaultProvider?.Id,
                ProviderType = defaultProvider?.ProviderType ?? "OpenAI",
                DefaultModel = defaultModel,
                AvailableModels = !string.IsNullOrWhiteSpace(defaultModel) ? JsonSerializer.Serialize(new[] { defaultModel }) : null,
                GroupName = "业务系统智能体",
                RepositoryIds = JsonSerializer.Serialize(repoIds),
                IsPublic = items.All(r => r.IsPublic),
                AllowedEmployeeNos = NormalizeEmployeeNos(string.Join(",", items.Select(r => r.AllowedEmployeeNos).Where(x => !string.IsNullOrWhiteSpace(x)))),
                IsActive = true,
                CreatedAt = DateTime.UtcNow
            };

            _context.ChatApps.Add(app);
        }

        await _context.SaveChangesAsync(cancellationToken);
    }

    private async Task<Dictionary<string, ChatAppBoundRepoDto>> LoadRepositoryMapAsync(CancellationToken cancellationToken)
    {
        var repos = await _context.Repositories
            .AsNoTracking()
            .Where(r => !r.IsDeleted)
            .Select(r => new ChatAppBoundRepoDto
            {
                Id = r.Id,
                OrgName = r.OrgName,
                RepoName = r.RepoName,
                Description = r.Description,
                StatusName = r.Status.ToString(),
                IsPublic = r.IsPublic
            })
            .ToListAsync(cancellationToken);

        return repos.ToDictionary(r => r.Id, StringComparer.OrdinalIgnoreCase);
    }

    private async Task<string?> CreateProviderFromLegacyAppConfigAsync(
        string appName,
        string? providerType,
        string? baseUrl,
        string? apiKey,
        string? modelId,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(apiKey) && string.IsNullOrWhiteSpace(baseUrl))
        {
            return null;
        }

        providerType = string.IsNullOrWhiteSpace(providerType) ? "OpenAI" : providerType;
        baseUrl = string.IsNullOrWhiteSpace(baseUrl)
            ? providerType.Equals("Anthropic", StringComparison.OrdinalIgnoreCase)
                ? "https://api.anthropic.com"
                : "https://api.openai.com/v1"
            : baseUrl.TrimEnd('/');

        var provider = new AiProviderConfig
        {
            Id = Guid.NewGuid().ToString(),
            Name = $"chat-app-{Guid.NewGuid():N}",
            DisplayName = $"{appName} Provider",
            ProviderType = providerType,
            BaseUrl = baseUrl,
            ApiKey = apiKey,
            AuthType = "ApiKey",
            IsActive = true,
            SupportsModelDiscovery = true,
            DefaultModelId = modelId,
            CreatedAt = DateTime.UtcNow
        };

        _context.AiProviderConfigs.Add(provider);

        if (!string.IsNullOrWhiteSpace(modelId))
        {
            _context.AiModelConfigs.Add(new AiModelConfig
            {
                Id = Guid.NewGuid().ToString(),
                ProviderId = provider.Id,
                ModelId = modelId,
                Name = modelId,
                DisplayName = modelId,
                ModelType = "chat",
                ProviderType = AiProviderResolver.NormalizeModelProviderType(null, modelId) ?? providerType,
                SupportsTools = true,
                IsActive = true,
                IsDefault = true,
                CreatedAt = DateTime.UtcNow
            });
        }

        await _context.SaveChangesAsync(cancellationToken);
        return provider.Id;
    }

    private static ChatAppDto MapToDto(
        ChatApp app,
        bool includeSecret,
        Dictionary<string, ChatAppBoundRepoDto> repoMap)
    {
        var repoIds = ParseJsonArray(app.RepositoryIds);
        var boundRepos = repoIds
            .Where(id => repoMap.ContainsKey(id))
            .Select(id => repoMap[id])
            .ToList();

        return new ChatAppDto
        {
            Id = app.Id,
            UserId = app.UserId,
            Name = app.Name,
            Description = app.Description,
            IconUrl = app.IconUrl,
            AppId = app.AppId,
            AppSecret = includeSecret ? app.AppSecret : null,
            EnableDomainValidation = app.EnableDomainValidation,
            AllowedDomains = ParseJsonArray(app.AllowedDomains),
            AiProviderId = app.AiProviderId,
            ProviderType = app.ProviderType,
            ApiKey = includeSecret ? app.ApiKey : MaskApiKey(app.ApiKey),
            BaseUrl = app.BaseUrl,
            AvailableModels = ParseJsonArray(app.AvailableModels),
            DefaultModel = app.DefaultModel,
            RateLimitPerMinute = app.RateLimitPerMinute,
            IsActive = app.IsActive,
            GroupName = app.GroupName,
            RepositoryIds = repoIds,
            BoundRepositories = boundRepos,
            SystemPrompt = app.SystemPrompt,
            IsPublic = app.IsPublic,
            AllowedEmployeeNos = app.AllowedEmployeeNos,
            CreatedAt = app.CreatedAt,
            UpdatedAt = app.UpdatedAt
        };
    }

    private static List<string> ParseJsonArray(string? json)
    {
        if (string.IsNullOrEmpty(json))
        {
            return new List<string>();
        }

        try
        {
            return JsonSerializer.Deserialize<List<string>>(json) ?? new List<string>();
        }
        catch
        {
            return new List<string>();
        }
    }

    private static string? NormalizeEmployeeNos(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return null;
        var items = raw.Split([',', ';', ' ', '\n', '\r', '，', '；'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
        return items.Count == 0 ? null : string.Join(",", items);
    }

    private static string? MaskApiKey(string? apiKey)
    {
        if (string.IsNullOrEmpty(apiKey) || apiKey.Length < 8)
        {
            return apiKey;
        }

        return $"{apiKey[..4]}****{apiKey[^4..]}";
    }
}
