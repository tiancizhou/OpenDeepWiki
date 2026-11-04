namespace OpenDeepWiki.Models.Admin;

/// <summary>
/// 仪表盘统计数据响应
/// </summary>
public class DashboardStatisticsResponse
{
    /// <summary>
    /// 每日仓库统计
    /// </summary>
    public List<DailyRepositoryStatistic> RepositoryStats { get; set; } = new();

    /// <summary>
    /// 每日用户统计
    /// </summary>
    public List<DailyUserStatistic> UserStats { get; set; } = new();
}

/// <summary>
/// 每日仓库统计
/// </summary>
public class DailyRepositoryStatistic
{
    public DateTime Date { get; set; }
    public int ProcessedCount { get; set; }
    public int SubmittedCount { get; set; }
}

/// <summary>
/// 每日用户统计
/// </summary>
public class DailyUserStatistic
{
    public DateTime Date { get; set; }
    public int NewUserCount { get; set; }
}

/// <summary>
/// Token 消耗统计响应
/// </summary>
public class TokenUsageStatisticsResponse
{
    public List<DailyTokenUsage> DailyUsages { get; set; } = new();
    public long TotalInputTokens { get; set; }
    public long TotalOutputTokens { get; set; }
    public long TotalCachedInputTokens { get; set; }
    public long TotalCacheCreationInputTokens { get; set; }
    public long TotalTokens { get; set; }
    public decimal InputCacheHitRate { get; set; }
    public decimal TotalInputCost { get; set; }
    public decimal TotalOutputCost { get; set; }
    public decimal TotalCost { get; set; }

    /// <summary>
    /// 按业务场景汇总的 Token 消耗组成（仓库初始化 vs 仓库增量同步 vs 智能体应用问答）
    /// </summary>
    public TokenCategoryBreakdown CategoryBreakdown { get; set; } = new();

    /// <summary>
    /// 各代码仓库的初始化与增量同步 Token 消耗明细
    /// </summary>
    public List<RepositoryTokenBreakdown> RepositoryBreakdowns { get; set; } = new();

    /// <summary>
    /// 各智能体应用的问答 Token 消耗明细
    /// </summary>
    public List<AgentAppTokenBreakdown> AgentAppBreakdowns { get; set; } = new();
}

/// <summary>
/// 按业务场景汇总的 Token 消耗
/// </summary>
public class TokenCategoryBreakdown
{
    public long RepoInitInputTokens { get; set; }
    public long RepoInitOutputTokens { get; set; }
    public long RepoInitCachedInputTokens { get; set; }
    public long RepoInitTotalTokens { get; set; }
    public int RepoInitCallCount { get; set; }

    public long RepoSyncInputTokens { get; set; }
    public long RepoSyncOutputTokens { get; set; }
    public long RepoSyncCachedInputTokens { get; set; }
    public long RepoSyncTotalTokens { get; set; }
    public int RepoSyncCallCount { get; set; }

    public long AgentAppInputTokens { get; set; }
    public long AgentAppOutputTokens { get; set; }
    public long AgentAppTotalTokens { get; set; }
    public long AgentAppRequestCount { get; set; }
}

/// <summary>
/// 单个代码仓库的 Token 消耗明细（区分初始化生成与增量同步）
/// </summary>
public class RepositoryTokenBreakdown
{
    public string RepositoryId { get; set; } = string.Empty;
    public string OrgName { get; set; } = string.Empty;
    public string RepoName { get; set; } = string.Empty;
    public string StatusName { get; set; } = string.Empty;

    public long InitInputTokens { get; set; }
    public long InitOutputTokens { get; set; }
    public long InitTotalTokens { get; set; }
    public int InitCallCount { get; set; }

    public long SyncInputTokens { get; set; }
    public long SyncOutputTokens { get; set; }
    public long SyncTotalTokens { get; set; }
    public int SyncCallCount { get; set; }

    public long CachedInputTokens { get; set; }
    public long TotalTokens { get; set; }
}

/// <summary>
/// 单个智能体应用的 Token 消耗明细
/// </summary>
public class AgentAppTokenBreakdown
{
    public string Id { get; set; } = string.Empty;
    public string AppId { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string GroupName { get; set; } = string.Empty;
    public int BoundRepoCount { get; set; }
    public long RequestCount { get; set; }
    public long InputTokens { get; set; }
    public long OutputTokens { get; set; }
    public long TotalTokens { get; set; }
}

/// <summary>
/// 每日 Token 消耗
/// </summary>
public class DailyTokenUsage
{
    public DateTime Date { get; set; }
    public long InputTokens { get; set; }
    public long OutputTokens { get; set; }
    public long CachedInputTokens { get; set; }
    public long CacheCreationInputTokens { get; set; }
    public long TotalTokens { get; set; }
    public decimal InputCacheHitRate { get; set; }
    public decimal InputCost { get; set; }
    public decimal OutputCost { get; set; }
    public decimal TotalCost { get; set; }
}
