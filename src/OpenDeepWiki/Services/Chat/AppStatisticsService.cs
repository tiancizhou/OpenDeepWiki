using Microsoft.EntityFrameworkCore;
using OpenDeepWiki.EFCore;
using OpenDeepWiki.Entities;

namespace OpenDeepWiki.Services.Chat;

/// <summary>
/// DTO for recording a request.
/// </summary>
public class RecordRequestDto
{
    public string AppId { get; set; } = string.Empty;
    public int InputTokens { get; set; }
    public int OutputTokens { get; set; }
}

/// <summary>
/// DTO for statistics response.
/// </summary>
public class AppStatisticsDto
{
    public string AppId { get; set; } = string.Empty;
    public DateTime Date { get; set; }
    public long RequestCount { get; set; }
    public long InputTokens { get; set; }
    public long OutputTokens { get; set; }
}

/// <summary>
/// DTO for aggregated statistics.
/// </summary>
public class AggregatedStatisticsDto
{
    public string AppId { get; set; } = string.Empty;
    public DateTime StartDate { get; set; }
    public DateTime EndDate { get; set; }
    public long TotalRequests { get; set; }
    public long TotalInputTokens { get; set; }
    public long TotalOutputTokens { get; set; }
    public List<AppStatisticsDto> DailyStatistics { get; set; } = new();
}


/// <summary>
/// Interface for app statistics service.
/// </summary>
public interface IAppStatisticsService
{
    /// <summary>
    /// Records a request for statistics tracking.
    /// </summary>
    Task RecordRequestAsync(RecordRequestDto dto, CancellationToken cancellationToken = default);

    /// <summary>
    /// Gets statistics for an app within a date range.
    /// </summary>
    Task<AggregatedStatisticsDto> GetStatisticsAsync(
        string appId,
        DateTime startDate,
        DateTime endDate,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Gets daily statistics for an app.
    /// </summary>
    Task<List<AppStatisticsDto>> GetDailyStatisticsAsync(
        string appId,
        DateTime startDate,
        DateTime endDate,
        CancellationToken cancellationToken = default);
}

/// <summary>
/// App statistics service implementation.
/// </summary>
public class AppStatisticsService : IAppStatisticsService
{
    private readonly IContext _context;
    private readonly ILogger<AppStatisticsService> _logger;

    public AppStatisticsService(IContext context, ILogger<AppStatisticsService> logger)
    {
        _context = context;
        _logger = logger;
    }

    /// <inheritdoc />
    public async Task RecordRequestAsync(RecordRequestDto dto, CancellationToken cancellationToken = default)
    {
        var today = DateTime.SpecifyKind(DateTime.UtcNow.Date, DateTimeKind.Utc);

        // Try to find existing statistics for today
        var stats = await _context.AppStatistics
            .FirstOrDefaultAsync(s => s.AppId == dto.AppId && s.Date == today && !s.IsDeleted, cancellationToken);

        if (stats == null)
        {
            // Create new statistics record for today
            stats = new AppStatistics
            {
                Id = Guid.NewGuid(),
                AppId = dto.AppId,
                Date = today,
                RequestCount = 1,
                InputTokens = dto.InputTokens,
                OutputTokens = dto.OutputTokens,
                CreatedAt = DateTime.UtcNow
            };
            _context.AppStatistics.Add(stats);
        }
        else
        {
            // Update existing statistics
            stats.RequestCount++;
            stats.InputTokens += dto.InputTokens;
            stats.OutputTokens += dto.OutputTokens;
            stats.UpdatedAt = DateTime.UtcNow;
        }

        await _context.SaveChangesAsync(cancellationToken);

        _logger.LogDebug("Recorded request for app {AppId}: +{InputTokens} input, +{OutputTokens} output",
            dto.AppId, dto.InputTokens, dto.OutputTokens);
    }


    /// <inheritdoc />
    public async Task<AggregatedStatisticsDto> GetStatisticsAsync(
        string appId,
        DateTime startDate,
        DateTime endDate,
        CancellationToken cancellationToken = default)
    {
        var startUtc = NormalizeUtcDate(startDate);
        var endUtc = NormalizeUtcDate(endDate);
        var dailyStats = await GetDailyStatisticsAsync(appId, startUtc, endUtc, cancellationToken);

        return new AggregatedStatisticsDto
        {
            AppId = appId,
            StartDate = startUtc,
            EndDate = endUtc,
            TotalRequests = dailyStats.Sum(s => s.RequestCount),
            TotalInputTokens = dailyStats.Sum(s => s.InputTokens),
            TotalOutputTokens = dailyStats.Sum(s => s.OutputTokens),
            DailyStatistics = dailyStats
        };
    }

    /// <inheritdoc />
    public async Task<List<AppStatisticsDto>> GetDailyStatisticsAsync(
        string appId,
        DateTime startDate,
        DateTime endDate,
        CancellationToken cancellationToken = default)
    {
        var startUtc = NormalizeUtcDate(startDate);
        var endExclusiveUtc = NormalizeUtcDate(endDate).AddDays(1);

        var rawStats = await _context.AppStatistics
            .AsNoTracking()
            .Where(s => s.AppId == appId && !s.IsDeleted && s.Date >= startUtc && s.Date < endExclusiveUtc)
            .ToListAsync(cancellationToken);

        if (rawStats.Count == 0)
        {
            // Fallback to aggregating from ChatLogs if AppStatistics has no rows yet
            var logs = await _context.ChatLogs
                .AsNoTracking()
                .Where(l => l.AppId == appId && !l.IsDeleted && l.CreatedAt >= startUtc && l.CreatedAt < endExclusiveUtc)
                .ToListAsync(cancellationToken);

            if (logs.Count > 0)
            {
                return logs
                    .GroupBy(l => l.CreatedAt.Date)
                    .OrderBy(g => g.Key)
                    .Select(g => new AppStatisticsDto
                    {
                        AppId = appId,
                        Date = DateTime.SpecifyKind(g.Key, DateTimeKind.Utc),
                        RequestCount = g.Count(),
                        InputTokens = g.Sum(x => (long)x.InputTokens),
                        OutputTokens = g.Sum(x => (long)x.OutputTokens)
                    })
                    .ToList();
            }
        }

        var stats = rawStats
            .GroupBy(s => s.Date.Date)
            .OrderBy(g => g.Key)
            .Select(g => new AppStatisticsDto
            {
                AppId = appId,
                Date = DateTime.SpecifyKind(g.Key, DateTimeKind.Utc),
                RequestCount = g.Sum(x => x.RequestCount),
                InputTokens = g.Sum(x => x.InputTokens),
                OutputTokens = g.Sum(x => x.OutputTokens)
            })
            .ToList();

        return stats;
    }

    private static DateTime NormalizeUtcDate(DateTime dt)
    {
        var utc = dt.Kind switch
        {
            DateTimeKind.Utc => dt,
            DateTimeKind.Local => dt.ToUniversalTime(),
            _ => DateTime.SpecifyKind(dt, DateTimeKind.Utc)
        };
        return DateTime.SpecifyKind(utc.Date, DateTimeKind.Utc);
    }
}
