using System.ComponentModel;
using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.AI;
using Microsoft.Extensions.DependencyInjection;
using OpenDeepWiki.EFCore;
using OpenDeepWiki.Entities;

namespace OpenDeepWiki.Agents.Tools;

/// <summary>
/// Provides Beijing-time date range parsing, daily change intent detection,
/// and Wiki knowledge-base change history reporting for chat agents.
/// </summary>
public static class WikiChangeReportTool
{
    public static readonly TimeSpan BeijingOffset = TimeSpan.FromHours(8);

    private static readonly Regex TimeAnchorRegex = new(
        @"(今天|今日|当天|当日|昨天|昨日|前天|每天|每日|按天|逐日|本周|这周|本星期|上周|上星期|本月|这个月|当月|上月|上个月|最近|近期|近来|最新|过去|这几天|近\s*[0-9一二两三四五六七八九十]+\s*[天日周月]|最近\s*[0-9一二两三四五六七八九十]+\s*[天日周月]|20\d{2}[-/年]\d{1,2}[-/月]\d{1,2}|\d{1,2}月\d{1,2}[日号]|日报|周报|月报|today|yesterday|daily|recent|this\s+week|last\s+week)",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    private static readonly Regex ChangeActionRegex = new(
        @"(新增|新加|添加|增加|修改|改动|变更|更新|迭代|调整|优化|修复|删除|提交|推送|合入|上线|发布|开发|改了|加了|变了|做了什么|干了什么|有哪些变化|什么变化|同步|commit|commits|diff|changelog|git\s*log)",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    private static readonly Regex ExplicitChangelogPhraseRegex = new(
        @"(更新日志|变更日志|变更记录|更新记录|修改记录|提交记录|提交历史|版本记录|每日更新|每日变更|每日新增|动态汇总|研发日报|代码提交)",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    public static DateTimeOffset GetBeijingNow() =>
        DateTimeOffset.UtcNow.ToOffset(BeijingOffset);

    public static string FormatBeijingWeekday(DayOfWeek dayOfWeek) => dayOfWeek switch
    {
        DayOfWeek.Monday => "星期一",
        DayOfWeek.Tuesday => "星期二",
        DayOfWeek.Wednesday => "星期三",
        DayOfWeek.Thursday => "星期四",
        DayOfWeek.Friday => "星期五",
        DayOfWeek.Saturday => "星期六",
        DayOfWeek.Sunday => "星期日",
        _ => string.Empty
    };

    public static string FormatCurrentBeijingTimeBanner()
    {
        var now = GetBeijingNow();
        return $"{now:yyyy-MM-dd HH:mm:ss} ({FormatBeijingWeekday(now.DayOfWeek)}, 北京时间 UTC+8)";
    }

    /// <summary>
    /// Determines whether a user question is asking about daily/recent/date-specific additions, modifications, or updates.
    /// Avoids false positives on static how-to questions (e.g., "如何新增用户", "修改密码接口").
    /// </summary>
    public static bool IsChangeHistoryQuestion(string? question)
    {
        if (string.IsNullOrWhiteSpace(question))
        {
            return false;
        }

        if (ExplicitChangelogPhraseRegex.IsMatch(question))
        {
            return true;
        }

        return TimeAnchorRegex.IsMatch(question) && ChangeActionRegex.IsMatch(question);
    }

    /// <summary>
    /// Parses explicit or natural-language date inputs into an inclusive Beijing-time [Start, End] window.
    /// </summary>
    public static (DateTimeOffset SinceBeijing, DateTimeOffset UntilBeijing, string Label) ParseBeijingDateWindow(
        string? sinceInput = null,
        string? untilInput = null,
        string? naturalLanguageHint = null)
    {
        var now = GetBeijingNow();
        var todayStart = new DateTimeOffset(now.Year, now.Month, now.Day, 0, 0, 0, BeijingOffset);
        var todayEnd = new DateTimeOffset(now.Year, now.Month, now.Day, 23, 59, 59, BeijingOffset);

        // 1. If explicit sinceInput or untilInput is provided, try structured/keyword parsing first
        if (!string.IsNullOrWhiteSpace(sinceInput) || !string.IsNullOrWhiteSpace(untilInput))
        {
            var sTrim = sinceInput?.Trim() ?? string.Empty;
            var uTrim = untilInput?.Trim() ?? string.Empty;

            var parsedSince = TryParseSingleDateToken(sTrim, now, isEndOfDay: false);
            var parsedUntil = TryParseSingleDateToken(uTrim, now, isEndOfDay: true);

            if (parsedSince.HasValue && parsedUntil.HasValue)
            {
                var start = parsedSince.Value <= parsedUntil.Value ? parsedSince.Value : parsedUntil.Value.Date == parsedSince.Value.Date ? parsedSince.Value : parsedUntil.Value;
                var end = parsedUntil.Value >= parsedSince.Value ? parsedUntil.Value : new DateTimeOffset(parsedSince.Value.Year, parsedSince.Value.Month, parsedSince.Value.Day, 23, 59, 59, BeijingOffset);
                return (start, end, FormatRangeLabel(start, end));
            }

            if (parsedSince.HasValue && string.IsNullOrWhiteSpace(uTrim))
            {
                // Check if sTrim itself represents a single day ("today", "yesterday", "2026-11-12") vs a relative span ("7d", "本周")
                if (TryParseKeywordWindow(sTrim, now, out var kwStart, out var kwEnd, out var kwLabel))
                {
                    return (kwStart, kwEnd, kwLabel);
                }

                var singleDayEnd = new DateTimeOffset(parsedSince.Value.Year, parsedSince.Value.Month, parsedSince.Value.Day, 23, 59, 59, BeijingOffset);
                var end = singleDayEnd < todayEnd && IsExactDayLiteral(sTrim) ? singleDayEnd : todayEnd;
                return (parsedSince.Value, end, FormatRangeLabel(parsedSince.Value, end));
            }

            if (!parsedSince.HasValue && parsedUntil.HasValue)
            {
                var start = new DateTimeOffset(parsedUntil.Value.Year, parsedUntil.Value.Month, parsedUntil.Value.Day, 0, 0, 0, BeijingOffset);
                return (start, parsedUntil.Value, FormatRangeLabel(start, parsedUntil.Value));
            }

            if (TryParseKeywordWindow($"{sTrim} {uTrim}", now, out var combinedStart, out var combinedEnd, out var combinedLabel))
            {
                return (combinedStart, combinedEnd, combinedLabel);
            }
        }

        // 2. Infer from naturalLanguageHint (e.g. user's Chinese question)
        if (!string.IsNullOrWhiteSpace(naturalLanguageHint) &&
            TryParseKeywordWindow(naturalLanguageHint, now, out var hintStart, out var hintEnd, out var hintLabel))
        {
            return (hintStart, hintEnd, hintLabel);
        }

        // Default: last 7 days grouped by day
        var defaultStart = todayStart.AddDays(-6);
        return (defaultStart, todayEnd, $"最近 7 天 ({defaultStart:yyyy-MM-dd} ~ {todayEnd:yyyy-MM-dd})");
    }

    private static bool IsExactDayLiteral(string input)
    {
        return Regex.IsMatch(input.Trim(), @"^(20\d{2}[-/年]\d{1,2}[-/月]\d{1,2}[日号]?|\d{1,2}[-/月]\d{1,2}[日号]?|today|yesterday|今天|今日|昨天|昨日|前天)$", RegexOptions.IgnoreCase);
    }

    private static bool TryParseKeywordWindow(
        string text,
        DateTimeOffset now,
        out DateTimeOffset start,
        out DateTimeOffset end,
        out string label)
    {
        var todayStart = new DateTimeOffset(now.Year, now.Month, now.Day, 0, 0, 0, BeijingOffset);
        var todayEnd = new DateTimeOffset(now.Year, now.Month, now.Day, 23, 59, 59, BeijingOffset);
        start = todayStart;
        end = todayEnd;
        label = string.Empty;

        // Explicit date range in text: e.g. 2026-11-10至2026-11-12 or 11月10日到11月12日
        var explicitDates = Regex.Matches(text, @"(?<y>20\d{2})[-/年](?<m>\d{1,2})[-/月](?<d>\d{1,2})[日号]?|(?<m2>\d{1,2})月(?<d2>\d{1,2})[日号]");
        if (explicitDates.Count >= 2)
        {
            var d1 = ExtractDateFromMatch(explicitDates[0], now, false);
            var d2 = ExtractDateFromMatch(explicitDates[1], now, true);
            if (d1.HasValue && d2.HasValue)
            {
                start = d1.Value <= d2.Value ? d1.Value : new DateTimeOffset(d2.Value.Year, d2.Value.Month, d2.Value.Day, 0, 0, 0, BeijingOffset);
                end = d2.Value >= d1.Value ? d2.Value : new DateTimeOffset(d1.Value.Year, d1.Value.Month, d1.Value.Day, 23, 59, 59, BeijingOffset);
                label = FormatRangeLabel(start, end);
                return true;
            }
        }
        else if (explicitDates.Count == 1)
        {
            var dStart = ExtractDateFromMatch(explicitDates[0], now, false);
            var dEnd = ExtractDateFromMatch(explicitDates[0], now, true);
            if (dStart.HasValue && dEnd.HasValue)
            {
                start = dStart.Value;
                end = dEnd.Value;
                label = $"{start:yyyy-MM-dd}";
                return true;
            }
        }

        // Relative N days/weeks: 最近3天, 近三天, 过去5天, 3d, 近一周, 最近半个月
        var relMatch = Regex.Match(text, @"(?:最近|近|过去|这|前)?\s*(?<num>\d+|[一二两三四五六七八九十半]+)\s*(?<unit>个?月|星期|周|天|日|d|w)\b", RegexOptions.IgnoreCase);
        if (relMatch.Success)
        {
            var numStr = relMatch.Groups["num"].Value;
            var unit = relMatch.Groups["unit"].Value.ToLowerInvariant();
            if (numStr == "半" && unit.Contains("月"))
            {
                start = todayStart.AddDays(-14);
                end = todayEnd;
                label = $"最近 15 天 ({start:yyyy-MM-dd} ~ {end:yyyy-MM-dd})";
                return true;
            }

            var n = ParseChineseOrArabicInt(numStr);
            if (n > 0)
            {
                var days = unit switch
                {
                    "w" or "周" or "星期" => n * 7,
                    "月" or "个月" => n * 30,
                    _ => n
                };
                days = Math.Clamp(days, 1, 90);
                start = todayStart.AddDays(-(days - 1));
                end = todayEnd;
                label = $"最近 {days} 天 ({start:yyyy-MM-dd} ~ {end:yyyy-MM-dd})";
                return true;
            }
        }

        var isDailySeries = Regex.IsMatch(text, @"(每天|每日|按天|逐日|这几天)", RegexOptions.IgnoreCase);

        if (Regex.IsMatch(text, @"(前天)", RegexOptions.IgnoreCase) && !isDailySeries)
        {
            start = todayStart.AddDays(-2);
            end = todayEnd.AddDays(-2);
            label = $"前天 ({start:yyyy-MM-dd})";
            return true;
        }

        if (Regex.IsMatch(text, @"(昨天|昨日|\byesterday\b)", RegexOptions.IgnoreCase) &&
            !Regex.IsMatch(text, @"(今天|今日|\btoday\b)", RegexOptions.IgnoreCase) &&
            !isDailySeries)
        {
            start = todayStart.AddDays(-1);
            end = todayEnd.AddDays(-1);
            label = $"昨天 ({start:yyyy-MM-dd})";
            return true;
        }

        if (Regex.IsMatch(text, @"(昨天|昨日)", RegexOptions.IgnoreCase) &&
            Regex.IsMatch(text, @"(今天|今日)", RegexOptions.IgnoreCase))
        {
            start = todayStart.AddDays(-1);
            end = todayEnd;
            label = $"昨天至今天 ({start:yyyy-MM-dd} ~ {end:yyyy-MM-dd})";
            return true;
        }

        if (Regex.IsMatch(text, @"(今天|今日|当天|当日|日报|\btoday\b)", RegexOptions.IgnoreCase) && !isDailySeries)
        {
            start = todayStart;
            end = todayEnd;
            label = $"今天 ({start:yyyy-MM-dd})";
            return true;
        }

        if (Regex.IsMatch(text, @"(上周|上星期|last\s+week)", RegexOptions.IgnoreCase))
        {
            var diffToMonday = ((int)now.DayOfWeek + 6) % 7;
            var thisMonday = todayStart.AddDays(-diffToMonday);
            start = thisMonday.AddDays(-7);
            end = new DateTimeOffset(thisMonday.AddDays(-1).Year, thisMonday.AddDays(-1).Month, thisMonday.AddDays(-1).Day, 23, 59, 59, BeijingOffset);
            label = $"上周 ({start:yyyy-MM-dd} ~ {end:yyyy-MM-dd})";
            return true;
        }

        if (Regex.IsMatch(text, @"(本周|这周|本星期|周报|this\s+week)", RegexOptions.IgnoreCase))
        {
            var diffToMonday = ((int)now.DayOfWeek + 6) % 7;
            start = todayStart.AddDays(-diffToMonday);
            end = todayEnd;
            label = $"本周 ({start:yyyy-MM-dd} ~ {end:yyyy-MM-dd})";
            return true;
        }

        if (Regex.IsMatch(text, @"(上月|上个月|last\s+month)", RegexOptions.IgnoreCase))
        {
            var firstOfThisMonth = new DateTimeOffset(now.Year, now.Month, 1, 0, 0, 0, BeijingOffset);
            var firstOfLastMonth = firstOfThisMonth.AddMonths(-1);
            var lastOfLastMonth = firstOfThisMonth.AddSeconds(-1);
            start = firstOfLastMonth;
            end = lastOfLastMonth;
            label = $"上月 ({start:yyyy-MM-dd} ~ {end:yyyy-MM-dd})";
            return true;
        }

        if (Regex.IsMatch(text, @"(本月|这个月|当月|月报|this\s+month)", RegexOptions.IgnoreCase))
        {
            start = new DateTimeOffset(now.Year, now.Month, 1, 0, 0, 0, BeijingOffset);
            end = todayEnd;
            label = $"本月 ({start:yyyy-MM-dd} ~ {end:yyyy-MM-dd})";
            return true;
        }

        if (isDailySeries || Regex.IsMatch(text, @"(最近|近期|近来|最新|daily|recent)", RegexOptions.IgnoreCase))
        {
            start = todayStart.AddDays(-6);
            end = todayEnd;
            label = $"最近 7 天按日汇总 ({start:yyyy-MM-dd} ~ {end:yyyy-MM-dd})";
            return true;
        }

        return false;
    }

    private static DateTimeOffset? TryParseSingleDateToken(string token, DateTimeOffset now, bool isEndOfDay)
    {
        if (string.IsNullOrWhiteSpace(token)) return null;
        token = token.Trim();

        if (string.Equals(token, "today", StringComparison.OrdinalIgnoreCase) || token is "今天" or "今日" or "当天")
        {
            return isEndOfDay
                ? new DateTimeOffset(now.Year, now.Month, now.Day, 23, 59, 59, BeijingOffset)
                : new DateTimeOffset(now.Year, now.Month, now.Day, 0, 0, 0, BeijingOffset);
        }

        if (string.Equals(token, "yesterday", StringComparison.OrdinalIgnoreCase) || token is "昨天" or "昨日")
        {
            var y = now.AddDays(-1);
            return isEndOfDay
                ? new DateTimeOffset(y.Year, y.Month, y.Day, 23, 59, 59, BeijingOffset)
                : new DateTimeOffset(y.Year, y.Month, y.Day, 0, 0, 0, BeijingOffset);
        }

        if (token == "前天")
        {
            var b = now.AddDays(-2);
            return isEndOfDay
                ? new DateTimeOffset(b.Year, b.Month, b.Day, 23, 59, 59, BeijingOffset)
                : new DateTimeOffset(b.Year, b.Month, b.Day, 0, 0, 0, BeijingOffset);
        }

        var m = Regex.Match(token, @"^(?:(?<y>20\d{2})[-/年])?(?<m>\d{1,2})[-/月](?<d>\d{1,2})[日号]?$");
        if (m.Success)
        {
            var year = m.Groups["y"].Success ? int.Parse(m.Groups["y"].Value, CultureInfo.InvariantCulture) : now.Year;
            var month = int.Parse(m.Groups["m"].Value, CultureInfo.InvariantCulture);
            var day = int.Parse(m.Groups["d"].Value, CultureInfo.InvariantCulture);
            if (month is >= 1 and <= 12 && day >= 1 && day <= DateTime.DaysInMonth(year, month))
            {
                var candidate = isEndOfDay
                    ? new DateTimeOffset(year, month, day, 23, 59, 59, BeijingOffset)
                    : new DateTimeOffset(year, month, day, 0, 0, 0, BeijingOffset);
                if (!m.Groups["y"].Success && candidate > now.AddDays(2))
                {
                    candidate = candidate.AddYears(-1);
                }
                return candidate;
            }
        }

        if (DateTimeOffset.TryParse(token, CultureInfo.InvariantCulture, DateTimeStyles.AssumeLocal, out var parsed))
        {
            var bj = parsed.ToOffset(BeijingOffset);
            if (!token.Contains(':'))
            {
                return isEndOfDay
                    ? new DateTimeOffset(bj.Year, bj.Month, bj.Day, 23, 59, 59, BeijingOffset)
                    : new DateTimeOffset(bj.Year, bj.Month, bj.Day, 0, 0, 0, BeijingOffset);
            }
            return bj;
        }

        return null;
    }

    private static DateTimeOffset? ExtractDateFromMatch(Match m, DateTimeOffset now, bool isEndOfDay)
    {
        int year;
        int month;
        int day;
        if (m.Groups["m"].Success)
        {
            year = int.Parse(m.Groups["y"].Value, CultureInfo.InvariantCulture);
            month = int.Parse(m.Groups["m"].Value, CultureInfo.InvariantCulture);
            day = int.Parse(m.Groups["d"].Value, CultureInfo.InvariantCulture);
        }
        else
        {
            year = now.Year;
            month = int.Parse(m.Groups["m2"].Value, CultureInfo.InvariantCulture);
            day = int.Parse(m.Groups["d2"].Value, CultureInfo.InvariantCulture);
        }

        if (month is < 1 or > 12 || day < 1 || day > DateTime.DaysInMonth(year, month))
        {
            return null;
        }

        var dt = isEndOfDay
            ? new DateTimeOffset(year, month, day, 23, 59, 59, BeijingOffset)
            : new DateTimeOffset(year, month, day, 0, 0, 0, BeijingOffset);

        if (!m.Groups["m"].Success && dt > now.AddDays(2))
        {
            dt = dt.AddYears(-1);
        }

        return dt;
    }

    private static int ParseChineseOrArabicInt(string raw)
    {
        if (int.TryParse(raw, NumberStyles.Integer, CultureInfo.InvariantCulture, out var v))
        {
            return v;
        }

        return raw switch
        {
            "一" => 1,
            "二" or "两" => 2,
            "三" => 3,
            "四" => 4,
            "五" => 5,
            "六" => 6,
            "七" => 7,
            "八" => 8,
            "九" => 9,
            "十" => 10,
            _ => 0
        };
    }

    private static string FormatRangeLabel(DateTimeOffset start, DateTimeOffset end) =>
        start.Date == end.Date
            ? $"{start:yyyy-MM-dd}"
            : $"{start:yyyy-MM-dd} ~ {end:yyyy-MM-dd}";

    /// <summary>
    /// Creates an AITool named GetWikiChanges backed by IContextFactory (thread-safe per invocation).
    /// </summary>
    public static AITool CreateTool(IContextFactory contextFactory, IReadOnlyCollection<string> repositoryIds)
    {
        async Task<string> GetWikiChangesAsync(
            [Description("Start date in YYYY-MM-DD or keyword like 'today', 'yesterday', '7d' (Beijing time). Leave empty for last 7 days.")]
            string sinceDate = "",
            [Description("End date in YYYY-MM-DD (inclusive, Beijing time). Leave empty to default to today or match sinceDate.")]
            string untilDate = "",
            CancellationToken cancellationToken = default)
        {
            using var db = contextFactory.CreateContext();
            var (sinceBj, untilBj, label) = ParseBeijingDateWindow(sinceDate, untilDate);
            return await QueryWikiChangesAsync(db, repositoryIds, sinceBj, untilBj, label, cancellationToken);
        }

        return AIFunctionFactory.Create(GetWikiChangesAsync, new AIFunctionFactoryOptions
        {
            Name = "GetWikiChanges",
            Description = "Queries newly added or modified Wiki documentation chapters and incremental sync tasks by date range (Beijing time)."
        });
    }

    /// <summary>
    /// Creates an AITool named GetWikiChanges backed by IServiceScopeFactory (thread-safe per invocation).
    /// </summary>
    public static AITool CreateTool(IServiceScopeFactory scopeFactory, IReadOnlyCollection<string> repositoryIds)
    {
        async Task<string> GetWikiChangesAsync(
            [Description("Start date in YYYY-MM-DD or keyword like 'today', 'yesterday', '7d' (Beijing time). Leave empty for last 7 days.")]
            string sinceDate = "",
            [Description("End date in YYYY-MM-DD (inclusive, Beijing time). Leave empty to default to today or match sinceDate.")]
            string untilDate = "",
            CancellationToken cancellationToken = default)
        {
            using var scope = scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<IContext>();
            var (sinceBj, untilBj, label) = ParseBeijingDateWindow(sinceDate, untilDate);
            return await QueryWikiChangesAsync(db, repositoryIds, sinceBj, untilBj, label, cancellationToken);
        }

        return AIFunctionFactory.Create(GetWikiChangesAsync, new AIFunctionFactoryOptions
        {
            Name = "GetWikiChanges",
            Description = "Queries newly added or modified Wiki documentation chapters and incremental sync tasks by date range (Beijing time)."
        });
    }

    /// <summary>
    /// Queries newly created or updated Wiki documents and incremental sync tasks within [sinceBeijing, untilBeijing].
    /// </summary>
    public static async Task<string> QueryWikiChangesAsync(
        IContext db,
        IReadOnlyCollection<string> repositoryIds,
        DateTimeOffset sinceBeijing,
        DateTimeOffset untilBeijing,
        string rangeLabel,
        CancellationToken cancellationToken = default)
    {
        if (repositoryIds == null || repositoryIds.Count == 0)
        {
            return "当前上下文未绑定代码仓库，无法查询 Wiki 文档变更记录。";
        }

        var repoIdArray = repositoryIds.Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
        var sinceUtc = sinceBeijing.UtcDateTime;
        var untilUtc = untilBeijing.UtcDateTime;

        var allDocs = await (
            from r in db.Repositories.AsNoTracking().Where(x => !x.IsDeleted && repoIdArray.Contains(x.Id))
            join b in db.RepositoryBranches.AsNoTracking().Where(x => !x.IsDeleted)
                on r.Id equals b.RepositoryId
            join bl in db.BranchLanguages.AsNoTracking().Where(x => !x.IsDeleted)
                on b.Id equals bl.RepositoryBranchId
            join c in db.DocCatalogs.AsNoTracking().Where(x => !x.IsDeleted && !string.IsNullOrEmpty(x.DocFileId))
                on bl.Id equals c.BranchLanguageId
            join d in db.DocFiles.AsNoTracking().Where(x => !x.IsDeleted)
                on c.DocFileId equals d.Id
            select new
            {
                r.Id,
                r.OrgName,
                r.RepoName,
                RepoCreatedAt = r.CreatedAt,
                b.BranchName,
                bl.LanguageCode,
                bl.UpdateSummary,
                c.Title,
                c.Path,
                DocCreatedAt = d.CreatedAt,
                DocUpdatedAt = d.UpdatedAt,
                d.SourceFiles
            }).ToListAsync(cancellationToken);

        // Prefer default/zh language if multiple translations exist for the same repo+path
        var dedupDocs = allDocs
            .GroupBy(x => $"{x.Id}:{x.Path}", StringComparer.OrdinalIgnoreCase)
            .Select(g => g.OrderByDescending(x => string.Equals(x.LanguageCode, "zh", StringComparison.OrdinalIgnoreCase)).First())
            .ToList();

        var syncTasks = await (
            from t in db.IncrementalUpdateTasks.AsNoTracking()
                .Where(x => !x.IsDeleted &&
                            repoIdArray.Contains(x.RepositoryId) &&
                            x.Status == IncrementalUpdateStatus.Completed &&
                            ((x.CompletedAt != null && x.CompletedAt >= sinceUtc && x.CompletedAt <= untilUtc) ||
                             (x.CreatedAt >= sinceUtc && x.CreatedAt <= untilUtc)))
            join r in db.Repositories.AsNoTracking() on t.RepositoryId equals r.Id
            orderby t.CompletedAt ?? t.CreatedAt descending
            select new
            {
                r.RepoName,
                t.PreviousCommitId,
                t.TargetCommitId,
                CompletedUtc = t.CompletedAt ?? t.CreatedAt
            }).Take(30).ToListAsync(cancellationToken);

        var sb = new StringBuilder();
        sb.AppendLine($"### Wiki 知识库文档变更记录（查询范围：{rangeLabel}，北京时间）");

        var events = new List<(DateTime DateKey, DateTimeOffset TimestampBj, string ChangeType, string RepoName, string Title, string Path, string? SourceFiles, bool IsInitialBatch)>();

        // Detect initial bulk generation per repo+day so initial 50-doc generation doesn't obscure daily incremental edits
        var createdCountByRepoDay = dedupDocs
            .GroupBy(d => (d.Id, Date: new DateTimeOffset(DateTime.SpecifyKind(d.DocCreatedAt, DateTimeKind.Utc)).ToOffset(BeijingOffset).Date))
            .ToDictionary(g => g.Key, g => g.Count());

        foreach (var doc in dedupDocs)
        {
            var createdBj = new DateTimeOffset(DateTime.SpecifyKind(doc.DocCreatedAt, DateTimeKind.Utc)).ToOffset(BeijingOffset);
            var updatedBj = doc.DocUpdatedAt.HasValue
                ? new DateTimeOffset(DateTime.SpecifyKind(doc.DocUpdatedAt.Value, DateTimeKind.Utc)).ToOffset(BeijingOffset)
                : (DateTimeOffset?)null;

            var isModifiedAfterCreation = updatedBj.HasValue && (updatedBj.Value - createdBj) > TimeSpan.FromMinutes(3);

            if (createdBj >= sinceBeijing && createdBj <= untilBeijing)
            {
                var sameDayCount = createdCountByRepoDay.GetValueOrDefault((doc.Id, createdBj.Date), 0);
                var repoCreatedBj = new DateTimeOffset(DateTime.SpecifyKind(doc.RepoCreatedAt, DateTimeKind.Utc)).ToOffset(BeijingOffset);
                var isInitial = sameDayCount >= 12 && Math.Abs((createdBj - repoCreatedBj).TotalHours) <= 24;
                events.Add((createdBj.Date, createdBj, "新增章节", doc.RepoName, doc.Title, doc.Path, doc.SourceFiles, isInitial));
            }

            if (isModifiedAfterCreation && updatedBj!.Value >= sinceBeijing && updatedBj.Value <= untilBeijing)
            {
                events.Add((updatedBj.Value.Date, updatedBj.Value, "更新章节", doc.RepoName, doc.Title, doc.Path, doc.SourceFiles, false));
            }
        }

        if (events.Count == 0 && syncTasks.Count == 0)
        {
            sb.AppendLine($"- 在 [{rangeLabel}] 时间段内，Wiki 文档章节暂无新增或重新生成记录（若开发人员刚刚提交代码，知识库增量文档同步可能尚未执行，请结合下方 Git 代码变更记录查看最新改动）。");

            var latestDocs = dedupDocs
                .Select(d =>
                {
                    var createdBj = new DateTimeOffset(DateTime.SpecifyKind(d.DocCreatedAt, DateTimeKind.Utc)).ToOffset(BeijingOffset);
                    var updatedBj = d.DocUpdatedAt.HasValue
                        ? new DateTimeOffset(DateTime.SpecifyKind(d.DocUpdatedAt.Value, DateTimeKind.Utc)).ToOffset(BeijingOffset)
                        : createdBj;
                    var isMod = d.DocUpdatedAt.HasValue && (updatedBj - createdBj) > TimeSpan.FromMinutes(3);
                    return new
                    {
                        d.RepoName,
                        d.Title,
                        d.Path,
                        TimeBj = updatedBj > createdBj ? updatedBj : createdBj,
                        Kind = isMod ? "更新章节" : "新增章节"
                    };
                })
                .OrderByDescending(x => x.TimeBj)
                .Take(5)
                .ToList();

            if (latestDocs.Count > 0)
            {
                sb.AppendLine("- 【参考：最近一次 Wiki 知识库文档变更记录】：");
                foreach (var item in latestDocs)
                {
                    sb.AppendLine($"  * [{item.TimeBj:yyyy-MM-dd HH:mm}] [{item.Kind}] ({item.RepoName}) 《{item.Title}》 (`{item.Path}`)");
                }
            }

            return sb.ToString().Trim();
        }

        var allDates = events.Select(e => e.DateKey)
            .Concat(syncTasks.Select(t => new DateTimeOffset(DateTime.SpecifyKind(t.CompletedUtc, DateTimeKind.Utc)).ToOffset(BeijingOffset).Date))
            .Distinct()
            .OrderByDescending(d => d)
            .ToList();

        foreach (var date in allDates)
        {
            sb.AppendLine();
            sb.AppendLine($"#### 📅 {date:yyyy-MM-dd} ({FormatBeijingWeekday(date.DayOfWeek)})");

            var dayTasks = syncTasks
                .Where(t => new DateTimeOffset(DateTime.SpecifyKind(t.CompletedUtc, DateTimeKind.Utc)).ToOffset(BeijingOffset).Date == date)
                .ToList();
            foreach (var task in dayTasks)
            {
                var tBj = new DateTimeOffset(DateTime.SpecifyKind(task.CompletedUtc, DateTimeKind.Utc)).ToOffset(BeijingOffset);
                var prevShort = string.IsNullOrEmpty(task.PreviousCommitId) ? "init" : task.PreviousCommitId[..Math.Min(7, task.PreviousCommitId.Length)];
                var currShort = string.IsNullOrEmpty(task.TargetCommitId) ? "head" : task.TargetCommitId[..Math.Min(7, task.TargetCommitId.Length)];
                sb.AppendLine($"- 🔄 **[知识库增量同步任务]** `{task.RepoName}` 于 {tBj:HH:mm:ss} 完成同步（Commit `{prevShort}` → `{currShort}`）");
            }

            var dayEvents = events.Where(e => e.DateKey == date).OrderByDescending(e => e.TimestampBj).ToList();

            // Collapse initial bulk generation if present
            var initialGroups = dayEvents.Where(e => e.IsInitialBatch).GroupBy(e => e.RepoName);
            foreach (var ig in initialGroups)
            {
                var sampleTitles = string.Join("、", ig.Take(5).Select(x => $"《{x.Title}》"));
                sb.AppendLine($"- 🆕 **[首次全量生成文档]** `{ig.Key}` 初始化生成共 {ig.Count()} 篇知识库章节（含 {sampleTitles} 等）");
            }

            foreach (var ev in dayEvents.Where(e => !e.IsInitialBatch))
            {
                var srcFiles = TryFormatSourceFilesShort(ev.SourceFiles);
                var tag = ev.ChangeType == "新增章节" ? "🆕 [新增 Wiki 章节]" : "✏️ [修改/更新 Wiki 章节]";
                sb.AppendLine($"- {tag} `{ev.RepoName}` | {ev.TimestampBj:HH:mm} | 《{ev.Title}》 (路径: `{ev.Path}`){srcFiles}");
            }
        }

        return sb.ToString().Trim();
    }

    private static string TryFormatSourceFilesShort(string? sourceFilesJson)
    {
        if (string.IsNullOrWhiteSpace(sourceFilesJson)) return string.Empty;
        try
        {
            var list = JsonSerializer.Deserialize<List<string>>(sourceFilesJson);
            if (list is { Count: > 0 })
            {
                return $" | 关联源码: `{string.Join("`, `", list.Take(4))}`" + (list.Count > 4 ? $" 等 {list.Count} 个文件" : "");
            }
        }
        catch
        {
            // Ignore malformed JSON
        }
        return string.Empty;
    }
}
