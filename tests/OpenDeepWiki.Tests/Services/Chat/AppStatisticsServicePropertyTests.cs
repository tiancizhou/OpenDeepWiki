using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using OpenDeepWiki.EFCore;
using OpenDeepWiki.Entities;
using OpenDeepWiki.Services.Chat;
using Xunit;

namespace OpenDeepWiki.Tests.Services.Chat;

/// <summary>
/// Property-based tests for AppStatisticsService.
/// Feature: doc-chat-assistant, Property 9: 统计数据记录完整性
/// Validates: Requirements 15.1, 15.3, 15.4
/// </summary>
public class AppStatisticsServicePropertyTests
{
    /// <summary>
    /// Creates an in-memory database context for testing.
    /// </summary>
    private static TestDbContext CreateTestContext()
    {
        var options = new DbContextOptionsBuilder<TestDbContext>()
            .UseInMemoryDatabase(databaseName: Guid.NewGuid().ToString())
            .Options;
        return new TestDbContext(options);
    }

    /// <summary>
    /// Generates valid AppIds.
    /// </summary>
    private static Gen<string> GenerateAppId()
    {
        return Gen.Elements(
            "app_test123456789012345678",
            "app_abcdef123456789012345678",
            "app_xyz987654321098765432"
        );
    }

    /// <summary>
    /// Generates valid token counts.
    /// </summary>
    private static Gen<int> GenerateTokenCount()
    {
        return Gen.Choose(1, 10000);
    }


    /// <summary>
    /// Property 9: 统计数据记录完整性 - 记录请求应该增加请求计数
    /// For any request recording, the request count should increase by 1.
    /// Validates: Requirements 15.1
    /// </summary>
    [Property(MaxTest = 100)]
    public Property RecordRequest_ShouldIncrementRequestCount()
    {
        return Prop.ForAll(
            GenerateAppId().ToArbitrary(),
            GenerateTokenCount().ToArbitrary(),
            GenerateTokenCount().ToArbitrary(),
            (appId, inputTokens, outputTokens) =>
            {
                using var context = CreateTestContext();
                var logger = NullLogger<AppStatisticsService>.Instance;
                var service = new AppStatisticsService(context, logger);

                // Record a request
                service.RecordRequestAsync(new RecordRequestDto
                {
                    AppId = appId,
                    InputTokens = inputTokens,
                    OutputTokens = outputTokens
                }).GetAwaiter().GetResult();

                // Verify request count is 1
                var stats = context.AppStatistics.FirstOrDefault(s => s.AppId == appId);
                return stats != null && stats.RequestCount == 1;
            });
    }

    /// <summary>
    /// Property 9: 统计数据记录完整性 - 多次记录应该累加请求计数
    /// For multiple request recordings, the request count should accumulate.
    /// Validates: Requirements 15.1
    /// </summary>
    [Property(MaxTest = 50)]
    public Property RecordRequest_MultipleTimes_ShouldAccumulateCount()
    {
        return Prop.ForAll(
            GenerateAppId().ToArbitrary(),
            Gen.Choose(2, 10).ToArbitrary(),
            (appId, recordCount) =>
            {
                using var context = CreateTestContext();
                var logger = NullLogger<AppStatisticsService>.Instance;
                var service = new AppStatisticsService(context, logger);

                // Record multiple requests
                for (int i = 0; i < recordCount; i++)
                {
                    service.RecordRequestAsync(new RecordRequestDto
                    {
                        AppId = appId,
                        InputTokens = 100,
                        OutputTokens = 50
                    }).GetAwaiter().GetResult();
                }

                // Verify request count equals the number of recordings
                var stats = context.AppStatistics.FirstOrDefault(s => s.AppId == appId);
                return stats != null && stats.RequestCount == recordCount;
            });
    }


    /// <summary>
    /// Property 9: 统计数据记录完整性 - 输入Token应该正确累加
    /// For any request recording, input tokens should be correctly accumulated.
    /// Validates: Requirements 15.3
    /// </summary>
    [Property(MaxTest = 100)]
    public Property RecordRequest_ShouldAccumulateInputTokens()
    {
        return Prop.ForAll(
            GenerateAppId().ToArbitrary(),
            GenerateTokenCount().ToArbitrary(),
            GenerateTokenCount().ToArbitrary(),
            (appId, inputTokens1, inputTokens2) =>
            {
                using var context = CreateTestContext();
                var logger = NullLogger<AppStatisticsService>.Instance;
                var service = new AppStatisticsService(context, logger);

                // Record two requests
                service.RecordRequestAsync(new RecordRequestDto
                {
                    AppId = appId,
                    InputTokens = inputTokens1,
                    OutputTokens = 0
                }).GetAwaiter().GetResult();

                service.RecordRequestAsync(new RecordRequestDto
                {
                    AppId = appId,
                    InputTokens = inputTokens2,
                    OutputTokens = 0
                }).GetAwaiter().GetResult();

                // Verify input tokens are accumulated
                var stats = context.AppStatistics.FirstOrDefault(s => s.AppId == appId);
                return stats != null && stats.InputTokens == inputTokens1 + inputTokens2;
            });
    }

    /// <summary>
    /// Property 9: 统计数据记录完整性 - 输出Token应该正确累加
    /// For any request recording, output tokens should be correctly accumulated.
    /// Validates: Requirements 15.4
    /// </summary>
    [Property(MaxTest = 100)]
    public Property RecordRequest_ShouldAccumulateOutputTokens()
    {
        return Prop.ForAll(
            GenerateAppId().ToArbitrary(),
            GenerateTokenCount().ToArbitrary(),
            GenerateTokenCount().ToArbitrary(),
            (appId, outputTokens1, outputTokens2) =>
            {
                using var context = CreateTestContext();
                var logger = NullLogger<AppStatisticsService>.Instance;
                var service = new AppStatisticsService(context, logger);

                // Record two requests
                service.RecordRequestAsync(new RecordRequestDto
                {
                    AppId = appId,
                    InputTokens = 0,
                    OutputTokens = outputTokens1
                }).GetAwaiter().GetResult();

                service.RecordRequestAsync(new RecordRequestDto
                {
                    AppId = appId,
                    InputTokens = 0,
                    OutputTokens = outputTokens2
                }).GetAwaiter().GetResult();

                // Verify output tokens are accumulated
                var stats = context.AppStatistics.FirstOrDefault(s => s.AppId == appId);
                return stats != null && stats.OutputTokens == outputTokens1 + outputTokens2;
            });
    }


    /// <summary>
    /// Property 9: 统计数据记录完整性 - 不同AppId应该有独立的统计
    /// For different AppIds, statistics should be independent.
    /// Validates: Requirements 15.1, 15.3, 15.4
    /// </summary>
    [Property(MaxTest = 50)]
    public Property RecordRequest_DifferentApps_ShouldBeIndependent()
    {
        return Prop.ForAll(
            GenerateTokenCount().ToArbitrary(),
            GenerateTokenCount().ToArbitrary(),
            (inputTokens, outputTokens) =>
            {
                using var context = CreateTestContext();
                var logger = NullLogger<AppStatisticsService>.Instance;
                var service = new AppStatisticsService(context, logger);

                var appId1 = "app_test111111111111111111";
                var appId2 = "app_test222222222222222222";

                // Record for app1
                service.RecordRequestAsync(new RecordRequestDto
                {
                    AppId = appId1,
                    InputTokens = inputTokens,
                    OutputTokens = outputTokens
                }).GetAwaiter().GetResult();

                // Record for app2 with different values
                service.RecordRequestAsync(new RecordRequestDto
                {
                    AppId = appId2,
                    InputTokens = inputTokens * 2,
                    OutputTokens = outputTokens * 2
                }).GetAwaiter().GetResult();

                // Verify each app has its own statistics
                var stats1 = context.AppStatistics.FirstOrDefault(s => s.AppId == appId1);
                var stats2 = context.AppStatistics.FirstOrDefault(s => s.AppId == appId2);

                return stats1 != null && stats2 != null &&
                       stats1.InputTokens == inputTokens &&
                       stats1.OutputTokens == outputTokens &&
                       stats2.InputTokens == inputTokens * 2 &&
                       stats2.OutputTokens == outputTokens * 2;
            });
    }

    /// <summary>
    /// Property 9: 统计数据记录完整性 - 统计应该关联到正确的日期
    /// For any request recording, statistics should be associated with today's date.
    /// Validates: Requirements 15.1
    /// </summary>
    [Property(MaxTest = 100)]
    public Property RecordRequest_ShouldAssociateWithTodayDate()
    {
        return Prop.ForAll(
            GenerateAppId().ToArbitrary(),
            GenerateTokenCount().ToArbitrary(),
            (appId, inputTokens) =>
            {
                using var context = CreateTestContext();
                var logger = NullLogger<AppStatisticsService>.Instance;
                var service = new AppStatisticsService(context, logger);

                var today = DateTime.UtcNow.Date;

                // Record a request
                service.RecordRequestAsync(new RecordRequestDto
                {
                    AppId = appId,
                    InputTokens = inputTokens,
                    OutputTokens = 0
                }).GetAwaiter().GetResult();

                // Verify the date is today
                var stats = context.AppStatistics.FirstOrDefault(s => s.AppId == appId);
                return stats != null && stats.Date == today;
            });
    }

    [Fact]
    public async Task GetDailyStatisticsAsync_WithUnspecifiedDateRange_ShouldNormalizeDatesToUtc()
    {
        using var context = CreateTestContext();
        var logger = NullLogger<AppStatisticsService>.Instance;
        var service = new AppStatisticsService(context, logger);
        var appId = "app_test_unspecified_date";
        var statsDate = DateTime.SpecifyKind(new DateTime(2026, 6, 29), DateTimeKind.Utc);

        context.AppStatistics.Add(new AppStatistics
        {
            Id = Guid.NewGuid(),
            AppId = appId,
            Date = statsDate,
            RequestCount = 3,
            InputTokens = 120,
            OutputTokens = 60,
            CreatedAt = DateTime.UtcNow
        });
        await context.SaveChangesAsync();

        var startDate = DateTime.SpecifyKind(new DateTime(2026, 6, 29), DateTimeKind.Unspecified);
        var endDate = DateTime.SpecifyKind(new DateTime(2026, 6, 29), DateTimeKind.Unspecified);

        var result = await service.GetDailyStatisticsAsync(appId, startDate, endDate);

        Assert.Single(result);
        Assert.Equal(statsDate, result[0].Date);
        Assert.Equal(DateTimeKind.Utc, result[0].Date.Kind);
    }

    [Fact]
    public async Task GetStatisticsAsync_WithUnspecifiedDateRange_ShouldReturnUtcDateBounds()
    {
        using var context = CreateTestContext();
        var logger = NullLogger<AppStatisticsService>.Instance;
        var service = new AppStatisticsService(context, logger);
        var appId = "app_test_statistics_bounds";

        var startDate = DateTime.SpecifyKind(new DateTime(2026, 6, 1), DateTimeKind.Unspecified);
        var endDate = DateTime.SpecifyKind(new DateTime(2026, 6, 30), DateTimeKind.Unspecified);

        var result = await service.GetStatisticsAsync(appId, startDate, endDate);

        Assert.Equal(DateTimeKind.Utc, result.StartDate.Kind);
        Assert.Equal(DateTimeKind.Utc, result.EndDate.Kind);
        Assert.Equal(new DateTime(2026, 6, 1, 0, 0, 0, DateTimeKind.Utc), result.StartDate);
        Assert.Equal(new DateTime(2026, 6, 30, 0, 0, 0, DateTimeKind.Utc), result.EndDate);
    }

    [Fact]
    public async Task RecordRequestAsync_ShouldStoreUtcDateForPostgresqlTimestampWithTimeZone()
    {
        using var context = CreateTestContext();
        var logger = NullLogger<AppStatisticsService>.Instance;
        var service = new AppStatisticsService(context, logger);

        await service.RecordRequestAsync(new RecordRequestDto
        {
            AppId = "app_test_utc_date",
            InputTokens = 10,
            OutputTokens = 5
        });

        var stats = await context.AppStatistics.SingleAsync();
        Assert.Equal(DateTimeKind.Utc, stats.Date.Kind);
    }
}

/// <summary>
/// Test database context for in-memory testing.
/// </summary>
public class TestDbContext : MasterDbContext
{
    public TestDbContext(DbContextOptions options) : base(options)
    {
    }
}
