using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using Microsoft.EntityFrameworkCore;
using OpenDeepWiki.EFCore;
using OpenDeepWiki.Services.Chat;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace OpenDeepWiki.Tests.Services.Chat;

/// <summary>
/// Property-based tests for ChatAppService.
/// Feature: doc-chat-assistant, Property 7: AppId唯一性
/// Validates: Requirements 12.2
/// </summary>
public class ChatAppServicePropertyTests
{
    private static readonly ILogger<ChatAppService> NullLogger = NullLogger<ChatAppService>.Instance;

    private static ChatAppServiceTestDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<ChatAppServiceTestDbContext>()
            .UseInMemoryDatabase(databaseName: Guid.NewGuid().ToString())
            .Options;

        return new ChatAppServiceTestDbContext(options);
    }

    /// <summary>
    /// Property 7: AppId唯一性 - 生成的AppId应该是全局唯一的
    /// For any number of generated AppIds, all should be unique.
    /// Validates: Requirements 12.2
    /// </summary>
    [Property(MaxTest = 100)]
    public Property GenerateAppId_ShouldBeUnique()
    {
        return Prop.ForAll(
            Gen.Choose(2, 100).ToArbitrary(),
            count =>
            {
                var service = new ChatAppService(null!, NullLogger);

                var appIds = Enumerable.Range(0, count)
                    .Select(_ => service.GenerateAppId())
                    .ToList();

                // All generated AppIds should be unique
                return appIds.Distinct().Count() == appIds.Count;
            });
    }

    /// <summary>
    /// Property 7: AppId唯一性 - AppId应该有正确的格式
    /// For any generated AppId, it should have the correct format (app_ prefix + 24 hex chars).
    /// Validates: Requirements 12.2
    /// </summary>
    [Property(MaxTest = 100)]
    public Property GenerateAppId_ShouldHaveCorrectFormat()
    {
        return Prop.ForAll(
            Gen.Constant(0).ToArbitrary(),
            _ =>
            {
                var service = new ChatAppService(null!, NullLogger);

                var appId = service.GenerateAppId();

                // Should start with "app_"
                var hasCorrectPrefix = appId.StartsWith("app_");
                
                // Should have correct length (4 for "app_" + 24 hex chars = 28)
                var hasCorrectLength = appId.Length == 28;
                
                // The hex part should only contain valid hex characters
                var hexPart = appId[4..];
                var isValidHex = hexPart.All(c => char.IsAsciiHexDigitLower(c));

                return hasCorrectPrefix && hasCorrectLength && isValidHex;
            });
    }


    /// <summary>
    /// Property 7: AppId唯一性 - AppSecret应该是全局唯一的
    /// For any number of generated AppSecrets, all should be unique.
    /// Validates: Requirements 12.2
    /// </summary>
    [Property(MaxTest = 100)]
    public Property GenerateAppSecret_ShouldBeUnique()
    {
        return Prop.ForAll(
            Gen.Choose(2, 100).ToArbitrary(),
            count =>
            {
                var service = new ChatAppService(null!, NullLogger);

                var secrets = Enumerable.Range(0, count)
                    .Select(_ => service.GenerateAppSecret())
                    .ToList();

                // All generated secrets should be unique
                return secrets.Distinct().Count() == secrets.Count;
            });
    }

    /// <summary>
    /// Property 7: AppId唯一性 - AppSecret应该有正确的格式
    /// For any generated AppSecret, it should have the correct format (sk_ prefix + 48 hex chars).
    /// Validates: Requirements 12.2
    /// </summary>
    [Property(MaxTest = 100)]
    public Property GenerateAppSecret_ShouldHaveCorrectFormat()
    {
        return Prop.ForAll(
            Gen.Constant(0).ToArbitrary(),
            _ =>
            {
                var service = new ChatAppService(null!, NullLogger);

                var secret = service.GenerateAppSecret();

                // Should start with "sk_"
                var hasCorrectPrefix = secret.StartsWith("sk_");
                
                // Should have correct length (3 for "sk_" + 48 hex chars = 51)
                var hasCorrectLength = secret.Length == 51;
                
                // The hex part should only contain valid hex characters
                var hexPart = secret[3..];
                var isValidHex = hexPart.All(c => char.IsAsciiHexDigitLower(c));

                return hasCorrectPrefix && hasCorrectLength && isValidHex;
            });
    }

    /// <summary>
    /// Property 7: AppId唯一性 - 大量生成时仍保持唯一性
    /// For a large number of generated AppIds, all should still be unique.
    /// Validates: Requirements 12.2
    /// </summary>
    [Property(MaxTest = 10)]
    public Property GenerateAppId_LargeScale_ShouldBeUnique()
    {
        return Prop.ForAll(
            Gen.Constant(1000).ToArbitrary(),
            count =>
            {
                var service = new ChatAppService(null!, NullLogger);

                var appIds = Enumerable.Range(0, count)
                    .Select(_ => service.GenerateAppId())
                    .ToList();

                // All generated AppIds should be unique even at scale
                return appIds.Distinct().Count() == appIds.Count;
            });
    }

    /// <summary>
    /// Property 7: AppId唯一性 - AppId和AppSecret应该互不相同
    /// For any generated AppId and AppSecret pair, they should be different.
    /// Validates: Requirements 12.2
    /// </summary>
    [Property(MaxTest = 100)]
    public Property GenerateAppIdAndSecret_ShouldBeDifferent()
    {
        return Prop.ForAll(
            Gen.Constant(0).ToArbitrary(),
            _ =>
            {
                var service = new ChatAppService(null!, NullLogger);

                var appId = service.GenerateAppId();
                var secret = service.GenerateAppSecret();

                // AppId and AppSecret should be different
                return appId != secret;
            });
    }

    [Fact]
    public async Task CreateAppAsync_ShouldPersistKnowledgeBinding()
    {
        using var context = CreateContext();
        var service = new ChatAppService(context, NullLogger);

        var app = await service.CreateAppAsync("user1", new CreateChatAppDto
        {
            Name = "Docs Bot",
            ProviderType = "OpenAI",
            ApiKey = "sk-test",
            AvailableModels = new List<string> { "gpt-4o-mini" },
            DefaultModel = "gpt-4o-mini",
            KnowledgeOwner = "AIDotNet",
            KnowledgeRepo = "OpenDeepWiki",
            KnowledgeBranch = "main",
            KnowledgeLanguage = "zh"
        });

        Assert.Equal("AIDotNet", app.KnowledgeOwner);
        Assert.Equal("OpenDeepWiki", app.KnowledgeRepo);
        Assert.Equal("main", app.KnowledgeBranch);
        Assert.Equal("zh", app.KnowledgeLanguage);
    }

    [Fact]
    public async Task UpdateAppAsync_ShouldClearKnowledgeBinding()
    {
        using var context = CreateContext();
        var service = new ChatAppService(context, NullLogger);

        var app = await service.CreateAppAsync("user1", new CreateChatAppDto
        {
            Name = "Docs Bot",
            ProviderType = "OpenAI",
            ApiKey = "sk-test",
            AvailableModels = new List<string> { "gpt-4o-mini" },
            DefaultModel = "gpt-4o-mini",
            KnowledgeOwner = "AIDotNet",
            KnowledgeRepo = "OpenDeepWiki",
            KnowledgeBranch = "main",
            KnowledgeLanguage = "zh"
        });

        var updated = await service.UpdateAppAsync(app.Id, "user1", new UpdateChatAppDto
        {
            KnowledgeOwner = string.Empty,
            KnowledgeRepo = string.Empty,
            KnowledgeBranch = string.Empty,
            KnowledgeLanguage = string.Empty
        });

        Assert.NotNull(updated);
        Assert.Null(updated.KnowledgeOwner);
        Assert.Null(updated.KnowledgeRepo);
        Assert.Null(updated.KnowledgeBranch);
        Assert.Null(updated.KnowledgeLanguage);
    }
}

public class ChatAppServiceTestDbContext : MasterDbContext
{
    public ChatAppServiceTestDbContext(DbContextOptions options) : base(options)
    {
    }
}
