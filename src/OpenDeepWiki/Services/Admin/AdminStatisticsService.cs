using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using OpenDeepWiki.EFCore;
using OpenDeepWiki.Models.Admin;

namespace OpenDeepWiki.Services.Admin;

/// <summary>
/// 管理端统计服务实现
/// </summary>
public class AdminStatisticsService : IAdminStatisticsService
{
    private readonly IContext _context;

    public AdminStatisticsService(IContext context)
    {
        _context = context;
    }

    public async Task<DashboardStatisticsResponse> GetDashboardStatisticsAsync(int days)
    {
        var todayUtc = DateTime.SpecifyKind(DateTime.UtcNow.Date, DateTimeKind.Utc);
        var startDate = DateTime.SpecifyKind(todayUtc.AddDays(-days + 1), DateTimeKind.Utc);
        var response = new DashboardStatisticsResponse();

        // 获取仓库统计
        var repoStats = await _context.Repositories
            .AsNoTracking()
            .Where(r => !r.IsDeleted && r.CreatedAt >= startDate)
            .GroupBy(r => r.CreatedAt.Date)
            .Select(g => new
            {
                Date = g.Key,
                SubmittedCount = g.Count(),
                ProcessedCount = g.Count(r => r.Status == Entities.RepositoryStatus.Completed)
            })
            .ToListAsync();

        // 获取用户统计
        var userStats = await _context.Users
            .AsNoTracking()
            .Where(u => !u.IsDeleted && u.CreatedAt >= startDate)
            .GroupBy(u => u.CreatedAt.Date)
            .Select(g => new { Date = g.Key, Count = g.Count() })
            .ToListAsync();

        // 填充每日数据
        for (var date = startDate; date <= todayUtc; date = date.AddDays(1))
        {
            var repoStat = repoStats.FirstOrDefault(r => r.Date.Date == date.Date);
            response.RepositoryStats.Add(new DailyRepositoryStatistic
            {
                Date = date,
                SubmittedCount = repoStat?.SubmittedCount ?? 0,
                ProcessedCount = repoStat?.ProcessedCount ?? 0
            });

            var userStat = userStats.FirstOrDefault(u => u.Date.Date == date.Date);
            response.UserStats.Add(new DailyUserStatistic
            {
                Date = date,
                NewUserCount = userStat?.Count ?? 0
            });
        }

        return response;
    }

    public async Task<TokenUsageStatisticsResponse> GetTokenUsageStatisticsAsync(int days)
    {
        var todayUtc = DateTime.SpecifyKind(DateTime.UtcNow.Date, DateTimeKind.Utc);
        var startDate = DateTime.SpecifyKind(todayUtc.AddDays(-days + 1), DateTimeKind.Utc);
        var response = new TokenUsageStatisticsResponse();

        // 1. 加载窗口内的 TokenUsages 明细
        var rawTokenUsages = await _context.TokenUsages
            .AsNoTracking()
            .Where(t => !t.IsDeleted && t.RecordedAt >= startDate)
            .Select(t => new
            {
                t.RepositoryId,
                t.Operation,
                t.InputTokens,
                t.OutputTokens,
                t.CachedInputTokens,
                t.CacheCreationInputTokens,
                t.InputCost,
                t.OutputCost,
                t.TotalCost,
                t.RecordedAt
            })
            .ToListAsync();

        // 2. 加载全部有效仓库
        var repositories = await _context.Repositories
            .AsNoTracking()
            .Where(r => !r.IsDeleted)
            .OrderBy(r => r.OrgName)
            .ThenBy(r => r.RepoName)
            .Select(r => new
            {
                r.Id,
                r.OrgName,
                r.RepoName,
                StatusName = r.Status.ToString()
            })
            .ToListAsync();

        // 3. 加载全部有效智能体应用 (ChatApps) 及其在窗口内的统计与提问记录
        var chatApps = await _context.ChatApps
            .AsNoTracking()
            .Where(a => !a.IsDeleted)
            .OrderBy(a => a.Name)
            .ToListAsync();

        var appStatsRows = await _context.AppStatistics
            .AsNoTracking()
            .Where(s => !s.IsDeleted && s.Date >= startDate)
            .ToListAsync();

        var chatLogRows = await _context.ChatLogs
            .AsNoTracking()
            .Where(l => !l.IsDeleted && l.CreatedAt >= startDate)
            .Select(l => new
            {
                l.AppId,
                l.InputTokens,
                l.OutputTokens,
                l.CreatedAt
            })
            .ToListAsync();

        // 按日期汇总智能体应用的 Token（优先使用 AppStatistics，若某应用仅有 ChatLogs 则用 ChatLogs 兜底）
        var appDailyByDate = new Dictionary<DateTime, (long Input, long Output)>();
        var appBreakdownList = new List<AgentAppTokenBreakdown>();

        long totalAgentInput = 0;
        long totalAgentOutput = 0;
        long totalAgentRequests = 0;

        foreach (var app in chatApps)
        {
            var statsForApp = appStatsRows.Where(s => s.AppId == app.AppId).ToList();
            var logsForApp = chatLogRows.Where(l => l.AppId == app.AppId).ToList();

            long reqCount;
            long inTok;
            long outTok;

            if (statsForApp.Count > 0)
            {
                reqCount = statsForApp.Sum(s => s.RequestCount);
                inTok = statsForApp.Sum(s => s.InputTokens);
                outTok = statsForApp.Sum(s => s.OutputTokens);

                foreach (var s in statsForApp)
                {
                    var d = s.Date.Date;
                    var prev = appDailyByDate.GetValueOrDefault(d);
                    appDailyByDate[d] = (prev.Input + s.InputTokens, prev.Output + s.OutputTokens);
                }
            }
            else
            {
                reqCount = logsForApp.Count;
                inTok = logsForApp.Sum(l => (long)l.InputTokens);
                outTok = logsForApp.Sum(l => (long)l.OutputTokens);

                foreach (var l in logsForApp)
                {
                    var d = l.CreatedAt.Date;
                    var prev = appDailyByDate.GetValueOrDefault(d);
                    appDailyByDate[d] = (prev.Input + l.InputTokens, prev.Output + l.OutputTokens);
                }
            }

            var boundIds = ParseJsonStringList(app.RepositoryIds);
            var boundCount = boundIds.Count > 0
                ? repositories.Count(r => boundIds.Contains(r.Id, StringComparer.OrdinalIgnoreCase))
                : repositories.Count(r => string.Equals(r.OrgName, app.Name, StringComparison.OrdinalIgnoreCase));

            appBreakdownList.Add(new AgentAppTokenBreakdown
            {
                Id = app.Id.ToString(),
                AppId = app.AppId,
                Name = app.Name,
                GroupName = string.IsNullOrWhiteSpace(app.GroupName) ? "业务系统智能体" : app.GroupName!,
                BoundRepoCount = boundCount,
                RequestCount = reqCount,
                InputTokens = inTok,
                OutputTokens = outTok,
                TotalTokens = inTok + outTok
            });

            totalAgentInput += inTok;
            totalAgentOutput += outTok;
            totalAgentRequests += reqCount;
        }

        response.AgentAppBreakdowns = appBreakdownList
            .OrderByDescending(a => a.TotalTokens)
            .ThenByDescending(a => a.RequestCount)
            .ThenBy(a => a.Name)
            .ToList();

        // 4. 按仓库与操作类型汇总（区分：仓库初始化生成 vs 仓库增量同步）
        var repoDict = repositories.ToDictionary(
            r => r.Id,
            r => new RepositoryTokenBreakdown
            {
                RepositoryId = r.Id,
                OrgName = r.OrgName,
                RepoName = r.RepoName,
                StatusName = r.StatusName
            },
            StringComparer.OrdinalIgnoreCase);

        long totalInitInput = 0, totalInitOutput = 0, totalInitCached = 0;
        int totalInitCalls = 0;

        long totalSyncInput = 0, totalSyncOutput = 0, totalSyncCached = 0;
        int totalSyncCalls = 0;

        foreach (var usage in rawTokenUsages)
        {
            var op = usage.Operation ?? string.Empty;
            // 若是智能体应用已单独通过 AppStatistics 统计的记录，跳过避免重复计入仓库
            if (op.StartsWith("agent_app:", StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            var isSync = op.Contains("incremental", StringComparison.OrdinalIgnoreCase) ||
                         op.Contains("sync", StringComparison.OrdinalIgnoreCase);

            var inTok = (long)usage.InputTokens;
            var outTok = (long)usage.OutputTokens;
            var cachedTok = (long)usage.CachedInputTokens;

            if (isSync)
            {
                totalSyncInput += inTok;
                totalSyncOutput += outTok;
                totalSyncCached += cachedTok;
                totalSyncCalls++;
            }
            else
            {
                totalInitInput += inTok;
                totalInitOutput += outTok;
                totalInitCached += cachedTok;
                totalInitCalls++;
            }

            if (!string.IsNullOrWhiteSpace(usage.RepositoryId))
            {
                if (!repoDict.TryGetValue(usage.RepositoryId, out var repoBreakdown))
                {
                    repoBreakdown = new RepositoryTokenBreakdown
                    {
                        RepositoryId = usage.RepositoryId,
                        OrgName = "已归档/历史仓库",
                        RepoName = usage.RepositoryId[..Math.Min(8, usage.RepositoryId.Length)],
                        StatusName = "Archived"
                    };
                    repoDict[usage.RepositoryId] = repoBreakdown;
                }

                if (isSync)
                {
                    repoBreakdown.SyncInputTokens += inTok;
                    repoBreakdown.SyncOutputTokens += outTok;
                    repoBreakdown.SyncTotalTokens += inTok + outTok;
                    repoBreakdown.SyncCallCount++;
                }
                else
                {
                    repoBreakdown.InitInputTokens += inTok;
                    repoBreakdown.InitOutputTokens += outTok;
                    repoBreakdown.InitTotalTokens += inTok + outTok;
                    repoBreakdown.InitCallCount++;
                }

                repoBreakdown.CachedInputTokens += cachedTok;
                repoBreakdown.TotalTokens = repoBreakdown.InitTotalTokens + repoBreakdown.SyncTotalTokens;
            }
        }

        response.RepositoryBreakdowns = repoDict.Values
            .OrderByDescending(r => r.TotalTokens)
            .ThenBy(r => r.OrgName)
            .ThenBy(r => r.RepoName)
            .ToList();

        response.CategoryBreakdown = new TokenCategoryBreakdown
        {
            RepoInitInputTokens = totalInitInput,
            RepoInitOutputTokens = totalInitOutput,
            RepoInitCachedInputTokens = totalInitCached,
            RepoInitTotalTokens = totalInitInput + totalInitOutput,
            RepoInitCallCount = totalInitCalls,

            RepoSyncInputTokens = totalSyncInput,
            RepoSyncOutputTokens = totalSyncOutput,
            RepoSyncCachedInputTokens = totalSyncCached,
            RepoSyncTotalTokens = totalSyncInput + totalSyncOutput,
            RepoSyncCallCount = totalSyncCalls,

            AgentAppInputTokens = totalAgentInput,
            AgentAppOutputTokens = totalAgentOutput,
            AgentAppTotalTokens = totalAgentInput + totalAgentOutput,
            AgentAppRequestCount = totalAgentRequests
        };

        // 5. 构建每日趋势数据（包含仓库 TokenUsages + 智能体应用问答 Token）
        var nonAgentTokenUsages = rawTokenUsages
            .Where(t => !(t.Operation ?? string.Empty).StartsWith("agent_app:", StringComparison.OrdinalIgnoreCase))
            .GroupBy(t => t.RecordedAt.Date)
            .ToDictionary(
                g => g.Key,
                g => new
                {
                    InputTokens = g.Sum(t => (long)t.InputTokens),
                    OutputTokens = g.Sum(t => (long)t.OutputTokens),
                    CachedInputTokens = g.Sum(t => (long)t.CachedInputTokens),
                    CacheCreationInputTokens = g.Sum(t => (long)t.CacheCreationInputTokens),
                    InputCost = g.Sum(t => t.InputCost),
                    OutputCost = g.Sum(t => t.OutputCost),
                    TotalCost = g.Sum(t => t.TotalCost)
                });

        for (var date = startDate; date <= todayUtc; date = date.AddDays(1))
        {
            nonAgentTokenUsages.TryGetValue(date.Date, out var stat);
            var appDay = appDailyByDate.GetValueOrDefault(date.Date);

            var inputTokens = (stat?.InputTokens ?? 0) + appDay.Input;
            var outputTokens = (stat?.OutputTokens ?? 0) + appDay.Output;
            var cachedInputTokens = stat?.CachedInputTokens ?? 0;
            var cacheCreationInputTokens = stat?.CacheCreationInputTokens ?? 0;
            var inputCost = stat?.InputCost ?? 0m;
            var outputCost = stat?.OutputCost ?? 0m;
            var totalCost = stat?.TotalCost ?? 0m;

            response.DailyUsages.Add(new DailyTokenUsage
            {
                Date = date,
                InputTokens = inputTokens,
                OutputTokens = outputTokens,
                CachedInputTokens = cachedInputTokens,
                CacheCreationInputTokens = cacheCreationInputTokens,
                TotalTokens = inputTokens + outputTokens,
                InputCacheHitRate = CalculateHitRate(cachedInputTokens, inputTokens),
                InputCost = inputCost,
                OutputCost = outputCost,
                TotalCost = totalCost
            });

            response.TotalInputTokens += inputTokens;
            response.TotalOutputTokens += outputTokens;
            response.TotalCachedInputTokens += cachedInputTokens;
            response.TotalCacheCreationInputTokens += cacheCreationInputTokens;
            response.TotalInputCost += inputCost;
            response.TotalOutputCost += outputCost;
            response.TotalCost += totalCost;
        }

        response.TotalTokens = response.TotalInputTokens + response.TotalOutputTokens;
        response.InputCacheHitRate = CalculateHitRate(response.TotalCachedInputTokens, response.TotalInputTokens);
        return response;
    }

    private static decimal CalculateHitRate(long cachedInputTokens, long inputTokens)
    {
        return inputTokens <= 0
            ? 0m
            : Math.Round((decimal)cachedInputTokens / inputTokens, 4);
    }

    private static List<string> ParseJsonStringList(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return [];
        try
        {
            return JsonSerializer.Deserialize<List<string>>(json) ?? [];
        }
        catch
        {
            return [];
        }
    }
}
