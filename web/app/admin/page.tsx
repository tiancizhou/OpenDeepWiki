"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Activity,
  BarChart3,
  Bot,
  Coins,
  Database,
  FolderGit2,
  GitBranch,
  Globe2,
  Layers,
  Percent,
  RefreshCw,
  Server,
  Sparkles,
  TrendingUp,
  Users,
  Zap,
} from "lucide-react";
import { useLocale } from "next-intl";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/admin/page-header";
import { StatCard } from "@/components/admin/stat-card";
import { cn } from "@/lib/utils";
import {
  getDashboardStatistics,
  getTokenUsageStatistics,
  getMcpUsageStatistics,
  DashboardStatistics,
  TokenUsageStatistics,
  McpUsageStatistics,
} from "@/lib/admin-api";
import { useTranslations } from "@/hooks/use-translations";

const CHART_COLORS = {
  freshInput: "#2563eb",
  cacheCreation: "#f59e0b",
  cacheHit: "#059669",
  output: "#7c3aed",
  submitted: "#0284c7",
  processed: "#16a34a",
  users: "#db2777",
  requests: "#0f766e",
  errors: "#dc2626",
  rate: "var(--foreground)",
};

type ChartDatum = Record<string, string | number>;

interface TooltipEntry {
  dataKey?: string | number;
  name?: string;
  value?: string | number;
  color?: string;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string;
  totalLabel?: string;
  valueFormatter?: (value: number, dataKey?: string) => string;
  hideTotal?: boolean;
}

function formatNumberWithUnits(value: number) {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";

  const formatCompact = (num: number, unit: "K" | "M" | "B") => {
    const fixed = num >= 100 ? num.toFixed(0) : num.toFixed(1);
    return `${sign}${fixed.replace(/\.0$/, "")}${unit}`;
  };

  if (abs >= 1_000_000_000) return formatCompact(abs / 1_000_000_000, "B");
  if (abs >= 1_000_000) return formatCompact(abs / 1_000_000, "M");
  if (abs >= 1_000) return formatCompact(abs / 1_000, "K");

  return value.toLocaleString();
}

function formatPercent(value: number) {
  return `${value.toFixed(value >= 10 ? 1 : 2).replace(/\.0$/, "")}%`;
}

function formatCurrency(value: number) {
  if (value <= 0) return "$0";
  if (value < 1) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}

function toDateLabel(date: string, locale: string) {
  return new Date(date).toLocaleDateString(locale, {
    month: "short",
    day: "numeric",
  });
}

function CustomTooltip({
  active,
  payload,
  label,
  totalLabel,
  valueFormatter,
  hideTotal,
}: CustomTooltipProps) {
  if (!active || !payload?.length) return null;

  const numericEntries = payload
    .filter((entry) => typeof entry.value === "number")
    .map((entry) => ({
      ...entry,
      value: entry.value as number,
      dataKey: entry.dataKey?.toString(),
    }));

  return (
    <div className="rounded-lg border bg-background/95 p-3 shadow-lg backdrop-blur">
      <p className="mb-2 text-xs font-medium text-muted-foreground">{label}</p>
      <div className="space-y-1.5">
        {numericEntries.map((entry) => (
          <div
            key={`${entry.dataKey}-${entry.name}`}
            className="flex items-center justify-between gap-6"
          >
            <div className="flex items-center gap-2">
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: entry.color }}
              />
              <span className="text-xs text-muted-foreground">
                {entry.name}
              </span>
            </div>
            <span className="text-xs font-semibold tabular-nums">
              {valueFormatter
                ? valueFormatter(entry.value, entry.dataKey)
                : entry.value.toLocaleString()}
            </span>
          </div>
        ))}
      </div>
      {!hideTotal && numericEntries.length > 1 && (
        <div className="mt-2 flex items-center justify-between border-t pt-2">
          <span className="text-xs text-muted-foreground">{totalLabel}</span>
          <span className="text-xs font-bold tabular-nums">
            {formatNumberWithUnits(
              numericEntries
                .filter((entry) => entry.dataKey !== "hitRate")
                .reduce((sum, entry) => sum + entry.value, 0)
            )}
          </span>
        </div>
      )}
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <span
        className="h-2 w-2 rounded-full"
        style={{ backgroundColor: color }}
      />
      <span>{label}</span>
    </div>
  );
}

function ChartPanel({
  title,
  description,
  meta,
  children,
  className,
}: {
  title: string;
  description: string;
  meta?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("gap-0 rounded-lg p-5 shadow-none", className)}>
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
        </div>
        {meta && (
          <span className="shrink-0 rounded-md border px-2 py-0.5 text-xs text-muted-foreground">
            {meta}
          </span>
        )}
      </div>
      {children}
    </Card>
  );
}

function BreakdownRow({
  label,
  value,
  detail,
  color,
}: {
  label: string;
  value: string;
  detail: string;
  color: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <span
        className="mt-1.5 h-2 w-2 rounded-full"
        style={{ backgroundColor: color }}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="text-sm font-semibold tabular-nums">{value}</p>
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p>
      </div>
    </div>
  );
}

function EmptyChartState({ label }: { label: string }) {
  return (
    <div className="flex h-[240px] items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">
      {label}
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div className="space-y-2">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-4 w-72" />
        </div>
        <Skeleton className="h-9 w-48" />
      </div>
      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-[130px] rounded-lg" />
        ))}
      </div>
      <Skeleton className="h-[420px] rounded-lg" />
      <div className="grid gap-4 xl:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-[340px] rounded-lg" />
        ))}
      </div>
    </div>
  );
}

const AXIS_TICK = { fill: "var(--muted-foreground)", fontSize: 11 };
const CURSOR_FILL = {
  fill: "color-mix(in oklab, var(--muted) 72%, transparent)",
};

export default function AdminDashboardPage() {
  const [dashboardStats, setDashboardStats] =
    useState<DashboardStatistics | null>(null);
  const [tokenStats, setTokenStats] = useState<TokenUsageStatistics | null>(
    null
  );
  const [mcpStats, setMcpStats] = useState<McpUsageStatistics | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(7);
  const t = useTranslations();
  const locale = useLocale();
  const dateLocale = locale === "zh" ? "zh-CN" : locale;

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      try {
        const [dashboard, token] = await Promise.all([
          getDashboardStatistics(days),
          getTokenUsageStatistics(days),
        ]);
        setDashboardStats(dashboard);
        setTokenStats(token);
        try {
          const mcp = await getMcpUsageStatistics(days);
          setMcpStats(mcp);
        } catch {
          setMcpStats(null);
        }
      } catch (error) {
        console.error("Failed to fetch statistics:", error);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [days]);

  const repoChartData = useMemo(
    () =>
      dashboardStats?.repositoryStats.map((stat) => ({
        date: toDateLabel(stat.date, dateLocale),
        submitted: stat.submittedCount,
        processed: stat.processedCount,
      })) || [],
    [dashboardStats, dateLocale]
  );

  const userChartData = useMemo(
    () =>
      dashboardStats?.userStats.map((stat) => ({
        date: toDateLabel(stat.date, dateLocale),
        users: stat.newUserCount,
      })) || [],
    [dashboardStats, dateLocale]
  );

  const tokenChartData = useMemo(
    () =>
      tokenStats?.dailyUsages.map((stat) => {
        const cacheHitTokens = stat.cachedInputTokens ?? 0;
        const cacheCreationTokens = stat.cacheCreationInputTokens ?? 0;
        const freshInputTokens = Math.max(
          stat.inputTokens - cacheHitTokens - cacheCreationTokens,
          0
        );

        return {
          date: toDateLabel(stat.date, dateLocale),
          freshInputTokens,
          cacheCreationTokens,
          cacheHitTokens,
          outputTokens: stat.outputTokens,
          hitRate: (stat.inputCacheHitRate ?? 0) * 100,
        };
      }) || [],
    [tokenStats, dateLocale]
  );

  const mcpChartData = useMemo(
    () =>
      mcpStats?.dailyUsages.map((stat) => ({
        date: toDateLabel(stat.date, dateLocale),
        requests: stat.requestCount,
        errors: stat.errorCount,
      })) || [],
    [mcpStats, dateLocale]
  );

  const sparklines = useMemo(
    () => ({
      submitted:
        dashboardStats?.repositoryStats.map((s) => s.submittedCount) || [],
      processed:
        dashboardStats?.repositoryStats.map((s) => s.processedCount) || [],
      users: dashboardStats?.userStats.map((s) => s.newUserCount) || [],
      tokens: tokenStats?.dailyUsages.map((s) => s.totalTokens) || [],
      hitRate:
        tokenStats?.dailyUsages.map((s) => (s.inputCacheHitRate ?? 0) * 100) ||
        [],
      mcp: mcpStats?.dailyUsages.map((s) => s.requestCount) || [],
    }),
    [dashboardStats, tokenStats, mcpStats]
  );

  const totalRepoSubmitted =
    dashboardStats?.repositoryStats.reduce(
      (sum, s) => sum + s.submittedCount,
      0
    ) || 0;
  const totalRepoProcessed =
    dashboardStats?.repositoryStats.reduce(
      (sum, s) => sum + s.processedCount,
      0
    ) || 0;
  const totalNewUsers =
    dashboardStats?.userStats.reduce((sum, s) => sum + s.newUserCount, 0) || 0;
  const repoCompletionRate =
    totalRepoSubmitted > 0
      ? (totalRepoProcessed / totalRepoSubmitted) * 100
      : 0;

  const totalInputTokens = tokenStats?.totalInputTokens ?? 0;
  const totalOutputTokens = tokenStats?.totalOutputTokens ?? 0;
  const totalCachedInputTokens = tokenStats?.totalCachedInputTokens ?? 0;
  const totalCacheCreationInputTokens =
    tokenStats?.totalCacheCreationInputTokens ?? 0;
  const totalFreshInputTokens = Math.max(
    totalInputTokens - totalCachedInputTokens - totalCacheCreationInputTokens,
    0
  );
  const inputCacheHitRate = (tokenStats?.inputCacheHitRate ?? 0) * 100;
  const totalTokens = tokenStats?.totalTokens ?? 0;
  const totalCost = tokenStats?.totalCost ?? 0;

  const categoryBreakdown = tokenStats?.categoryBreakdown;
  const repoBreakdowns = tokenStats?.repositoryBreakdowns ?? [];
  const agentAppBreakdowns = tokenStats?.agentAppBreakdowns ?? [];

  const repoInitTotal = categoryBreakdown?.repoInitTotalTokens ?? 0;
  const repoSyncTotal = categoryBreakdown?.repoSyncTotalTokens ?? 0;
  const agentAppTotal = categoryBreakdown?.agentAppTotalTokens ?? 0;
  const categorySum = Math.max(repoInitTotal + repoSyncTotal + agentAppTotal, totalTokens, 1);

  const repoInitPct = (repoInitTotal / categorySum) * 100;
  const repoSyncPct = (repoSyncTotal / categorySum) * 100;
  const agentAppPct = (agentAppTotal / categorySum) * 100;

  const totalMcpRequests = mcpStats?.totalRequests ?? 0;
  const totalMcpSuccessful = mcpStats?.totalSuccessful ?? 0;
  const totalMcpErrors = mcpStats?.totalErrors ?? 0;
  const mcpSuccessRate =
    totalMcpRequests > 0 ? (totalMcpSuccessful / totalMcpRequests) * 100 : 0;

  const updatedAt = new Date().toLocaleString(dateLocale, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  if (loading) {
    return <DashboardSkeleton />;
  }

  const tokenValueFormatter = (value: number, dataKey?: string) =>
    dataKey === "hitRate" ? formatPercent(value) : formatNumberWithUnits(value);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("admin.dashboard.title")}
        description={t("admin.dashboard.subtitle", { days })}
        actions={
          <>
            <div className="hidden items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs text-muted-foreground sm:flex">
              <Activity className="h-3.5 w-3.5" />
              <span className="font-medium text-foreground">
                {t("admin.dashboard.updatedAt")}
              </span>
              {updatedAt}
            </div>
            <Tabs
              value={days.toString()}
              onValueChange={(value) => setDays(Number.parseInt(value, 10))}
            >
              <TabsList>
                <TabsTrigger value="7">{t("admin.dashboard.days7")}</TabsTrigger>
                <TabsTrigger value="14">
                  {t("admin.dashboard.days14")}
                </TabsTrigger>
                <TabsTrigger value="30">
                  {t("admin.dashboard.days30")}
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </>
        }
      />

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        <StatCard
          icon={GitBranch}
          label={t("admin.dashboard.repoSubmit")}
          value={totalRepoSubmitted.toLocaleString()}
          detail={t("admin.dashboard.repoSubmitDetail", {
            count: totalRepoProcessed,
          })}
          tone="blue"
          sparkline={sparklines.submitted}
        />
        <StatCard
          icon={TrendingUp}
          label={t("admin.dashboard.processed")}
          value={totalRepoProcessed.toLocaleString()}
          detail={t("admin.dashboard.completionRate", {
            rate: formatPercent(repoCompletionRate),
          })}
          tone="green"
          sparkline={sparklines.processed}
        />
        <StatCard
          icon={Users}
          label={t("admin.dashboard.newUsers")}
          value={totalNewUsers.toLocaleString()}
          detail={t("admin.dashboard.newUsersDetail", { days })}
          tone="rose"
          sparkline={sparklines.users}
        />
        <StatCard
          icon={Coins}
          label={t("admin.dashboard.tokenUsage")}
          value={formatNumberWithUnits(totalTokens)}
          detail={t("admin.dashboard.tokenUsageDetail", {
            cost: formatCurrency(totalCost),
          })}
          tone="amber"
          sparkline={sparklines.tokens}
        />
        <StatCard
          icon={Percent}
          label={t("admin.dashboard.cacheHitRate")}
          value={formatPercent(inputCacheHitRate)}
          detail={t("admin.dashboard.cacheHitRateDetail", {
            count: formatNumberWithUnits(totalCachedInputTokens),
          })}
          tone="violet"
          progress={inputCacheHitRate}
          sparkline={sparklines.hitRate}
        />
        <StatCard
          icon={Globe2}
          label={t("admin.dashboard.mcpTotal")}
          value={totalMcpRequests.toLocaleString()}
          detail={t("admin.dashboard.mcpSuccessRate", {
            rate: formatPercent(mcpSuccessRate),
          })}
          tone="cyan"
          sparkline={sparklines.mcp}
        />
      </section>

      <Card className="gap-0 overflow-hidden rounded-lg py-0 shadow-none">
        <div className="grid xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="p-5">
            <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <h2 className="text-base font-semibold">
                  {t("admin.dashboard.tokenTrend")}
                </h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {t("admin.dashboard.tokenTrendDescription")}
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <LegendDot
                  color={CHART_COLORS.freshInput}
                  label={t("admin.dashboard.freshInputToken")}
                />
                <LegendDot
                  color={CHART_COLORS.cacheCreation}
                  label={t("admin.dashboard.cacheCreationToken")}
                />
                <LegendDot
                  color={CHART_COLORS.cacheHit}
                  label={t("admin.dashboard.cacheHitToken")}
                />
                <LegendDot
                  color={CHART_COLORS.output}
                  label={t("admin.dashboard.outputToken")}
                />
                <LegendDot
                  color="var(--foreground)"
                  label={t("admin.dashboard.cacheHitRate")}
                />
              </div>
            </div>

            {tokenChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={340}>
                <ComposedChart
                  data={tokenChartData as ChartDatum[]}
                  margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
                >
                  <defs>
                    {(
                      [
                        ["gradFresh", CHART_COLORS.freshInput],
                        ["gradCreate", CHART_COLORS.cacheCreation],
                        ["gradHit", CHART_COLORS.cacheHit],
                        ["gradOut", CHART_COLORS.output],
                      ] as const
                    ).map(([id, color]) => (
                      <linearGradient
                        key={id}
                        id={id}
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="1"
                      >
                        <stop offset="0%" stopColor={color} stopOpacity={0.5} />
                        <stop
                          offset="100%"
                          stopColor={color}
                          stopOpacity={0.06}
                        />
                      </linearGradient>
                    ))}
                  </defs>
                  <CartesianGrid
                    stroke="var(--border)"
                    strokeDasharray="3 3"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="date"
                    axisLine={false}
                    tickLine={false}
                    tick={AXIS_TICK}
                  />
                  <YAxis
                    yAxisId="tokens"
                    axisLine={false}
                    tickLine={false}
                    tick={AXIS_TICK}
                    tickFormatter={formatNumberWithUnits}
                  />
                  <YAxis
                    yAxisId="rate"
                    orientation="right"
                    axisLine={false}
                    tickLine={false}
                    tick={AXIS_TICK}
                    tickFormatter={(value) => formatPercent(Number(value))}
                  />
                  <Tooltip
                    cursor={CURSOR_FILL}
                    content={
                      <CustomTooltip
                        totalLabel={t("admin.dashboard.total")}
                        valueFormatter={tokenValueFormatter}
                      />
                    }
                  />
                  <Area
                    yAxisId="tokens"
                    type="monotone"
                    dataKey="freshInputTokens"
                    name={t("admin.dashboard.freshInputToken")}
                    stackId="tokens"
                    stroke={CHART_COLORS.freshInput}
                    strokeWidth={1.5}
                    fill="url(#gradFresh)"
                  />
                  <Area
                    yAxisId="tokens"
                    type="monotone"
                    dataKey="cacheCreationTokens"
                    name={t("admin.dashboard.cacheCreationToken")}
                    stackId="tokens"
                    stroke={CHART_COLORS.cacheCreation}
                    strokeWidth={1.5}
                    fill="url(#gradCreate)"
                  />
                  <Area
                    yAxisId="tokens"
                    type="monotone"
                    dataKey="cacheHitTokens"
                    name={t("admin.dashboard.cacheHitToken")}
                    stackId="tokens"
                    stroke={CHART_COLORS.cacheHit}
                    strokeWidth={1.5}
                    fill="url(#gradHit)"
                  />
                  <Area
                    yAxisId="tokens"
                    type="monotone"
                    dataKey="outputTokens"
                    name={t("admin.dashboard.outputToken")}
                    stackId="tokens"
                    stroke={CHART_COLORS.output}
                    strokeWidth={1.5}
                    fill="url(#gradOut)"
                  />
                  <Line
                    yAxisId="rate"
                    type="monotone"
                    dataKey="hitRate"
                    name={t("admin.dashboard.cacheHitRate")}
                    stroke={CHART_COLORS.rate}
                    strokeWidth={2}
                    dot={{ r: 2.5, strokeWidth: 2 }}
                    activeDot={{ r: 4 }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            ) : (
              <EmptyChartState label={t("admin.dashboard.noData")} />
            )}
          </div>

          <aside className="border-t bg-muted/25 p-5 xl:border-l xl:border-t-0">
            <div className="mb-4 flex items-center gap-2">
              <Database className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold">
                {t("admin.dashboard.tokenComposition")}
              </h3>
            </div>
            <div className="space-y-4">
              <BreakdownRow
                color={CHART_COLORS.freshInput}
                label={t("admin.dashboard.freshInputToken")}
                value={formatNumberWithUnits(totalFreshInputTokens)}
                detail={t("admin.dashboard.freshInputTokenDetail")}
              />
              <BreakdownRow
                color={CHART_COLORS.cacheCreation}
                label={t("admin.dashboard.cacheCreationToken")}
                value={formatNumberWithUnits(totalCacheCreationInputTokens)}
                detail={t("admin.dashboard.cacheCreationTokenDetail")}
              />
              <BreakdownRow
                color={CHART_COLORS.cacheHit}
                label={t("admin.dashboard.cacheHitToken")}
                value={formatNumberWithUnits(totalCachedInputTokens)}
                detail={t("admin.dashboard.cacheHitTokenDetail")}
              />
              <BreakdownRow
                color={CHART_COLORS.output}
                label={t("admin.dashboard.outputToken")}
                value={formatNumberWithUnits(totalOutputTokens)}
                detail={t("admin.dashboard.outputTokenDetail")}
              />
            </div>

            <div className="mt-5 border-t pt-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm text-muted-foreground">
                  {t("admin.dashboard.cacheHitRate")}
                </span>
                <span className="text-sm font-semibold tabular-nums">
                  {formatPercent(inputCacheHitRate)}
                </span>
              </div>
              <Progress value={inputCacheHitRate} className="h-1.5" />
              <p className="mt-3 text-xs leading-5 text-muted-foreground">
                {t("admin.dashboard.cacheEfficiencyDescription")}
              </p>
            </div>
          </aside>
        </div>
      </Card>

      {/* ==================== Token 消耗业务组成与仓库/智能体明细 ==================== */}
      <Card className="gap-0 rounded-lg p-5 shadow-none space-y-5">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-semibold flex items-center gap-2">
              <Layers className="h-4 w-4 text-emerald-500" />
              Token 消耗业务组成明细（仓库初始化 / 增量同步 / 智能体应用）
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              拆解最近 {days} 天内各代码仓库「初始化构建」、「增量同步更新」以及「智能体应用对外问答」的 Token 消耗构成。
            </p>
          </div>
          <Badge variant="outline" className="text-xs font-normal self-start sm:self-center">
            窗口累计消耗：{formatNumberWithUnits(totalTokens)} Tokens（{totalTokens.toLocaleString()}）
          </Badge>
        </div>

        {/* 1. 三大业务场景汇总卡片 */}
        <div className="grid gap-4 md:grid-cols-3">
          {/* 场景一：仓库初始化构建 */}
          <div className="rounded-lg border bg-muted/15 p-4 space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <FolderGit2 className="h-4 w-4 text-blue-500" />
                仓库初始化花费 Token
              </div>
              <Badge variant="secondary" className="text-xs tabular-nums">
                占比 {formatPercent(repoInitPct)}
              </Badge>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-2xl font-bold tabular-nums">
                {formatNumberWithUnits(repoInitTotal)}
              </span>
              <span className="text-xs text-muted-foreground tabular-nums">
                共 {categoryBreakdown?.repoInitCallCount ?? 0} 次生成调用
              </span>
            </div>
            <Progress value={repoInitPct} className="h-1.5" />
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground pt-0.5">
              <span>
                输入 {formatNumberWithUnits(categoryBreakdown?.repoInitInputTokens ?? 0)} / 输出{" "}
                {formatNumberWithUnits(categoryBreakdown?.repoInitOutputTokens ?? 0)}
              </span>
              <span>
                命中缓存 {formatNumberWithUnits(categoryBreakdown?.repoInitCachedInputTokens ?? 0)}
              </span>
            </div>
          </div>

          {/* 场景二：仓库增量同步 */}
          <div className="rounded-lg border bg-muted/15 p-4 space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <RefreshCw className="h-4 w-4 text-emerald-500" />
                仓库增量同步花费 Token
              </div>
              <Badge variant="secondary" className="text-xs tabular-nums">
                占比 {formatPercent(repoSyncPct)}
              </Badge>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-2xl font-bold tabular-nums">
                {formatNumberWithUnits(repoSyncTotal)}
              </span>
              <span className="text-xs text-muted-foreground tabular-nums">
                共 {categoryBreakdown?.repoSyncCallCount ?? 0} 次同步调用
              </span>
            </div>
            <Progress value={repoSyncPct} className="h-1.5" />
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground pt-0.5">
              <span>
                输入 {formatNumberWithUnits(categoryBreakdown?.repoSyncInputTokens ?? 0)} / 输出{" "}
                {formatNumberWithUnits(categoryBreakdown?.repoSyncOutputTokens ?? 0)}
              </span>
              <span>
                命中缓存 {formatNumberWithUnits(categoryBreakdown?.repoSyncCachedInputTokens ?? 0)}
              </span>
            </div>
          </div>

          {/* 场景三：智能体应用问答 */}
          <div className="rounded-lg border bg-muted/15 p-4 space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Bot className="h-4 w-4 text-violet-500" />
                智能体应用花费 Token
              </div>
              <Badge variant="secondary" className="text-xs tabular-nums">
                占比 {formatPercent(agentAppPct)}
              </Badge>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-2xl font-bold tabular-nums">
                {formatNumberWithUnits(agentAppTotal)}
              </span>
              <span className="text-xs text-muted-foreground tabular-nums">
                共 {categoryBreakdown?.agentAppRequestCount ?? 0} 次问答请求
              </span>
            </div>
            <Progress value={agentAppPct} className="h-1.5" />
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground pt-0.5">
              <span>
                输入 {formatNumberWithUnits(categoryBreakdown?.agentAppInputTokens ?? 0)} / 输出{" "}
                {formatNumberWithUnits(categoryBreakdown?.agentAppOutputTokens ?? 0)}
              </span>
              <span>含 ZtWork 连接器、MCP 与在线问答</span>
            </div>
          </div>
        </div>

        {/* 2. 具体仓库明细表 & 智能体应用明细表 */}
        <div className="grid gap-5 xl:grid-cols-12">
          {/* 左栏：各代码仓库初始化 & 增量同步 Token 消耗明细 */}
          <div className="xl:col-span-7 space-y-2.5">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold flex items-center gap-1.5">
                <FolderGit2 className="h-4 w-4 text-blue-500" />
                各代码仓库 Token 消耗明细（初始化构建 vs 增量同步）
              </h3>
              <span className="text-xs text-muted-foreground">
                共 {repoBreakdowns.length} 个代码仓库
              </span>
            </div>

            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b bg-muted/40 text-muted-foreground">
                    <th className="text-left py-2.5 px-3 font-medium">代码仓库 (所属仓库组/系统)</th>
                    <th className="text-right py-2.5 px-3 font-medium">初始化花费 Token</th>
                    <th className="text-right py-2.5 px-3 font-medium">增量同步花费 Token</th>
                    <th className="text-right py-2.5 px-3 font-medium">缓存命中</th>
                    <th className="text-right py-2.5 px-3 font-medium">合计消耗 &amp; 占比</th>
                  </tr>
                </thead>
                <tbody>
                  {repoBreakdowns.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-muted-foreground">
                        暂无仓库 Token 消耗记录
                      </td>
                    </tr>
                  ) : (
                    repoBreakdowns.map((repo) => {
                      const pct = categorySum > 0 ? (repo.totalTokens / categorySum) * 100 : 0;
                      return (
                        <tr
                          key={repo.repositoryId}
                          className="border-b last:border-0 hover:bg-muted/25 transition-colors"
                        >
                          <td className="py-2.5 px-3">
                            <div className="font-semibold text-foreground">
                              {repo.orgName} / {repo.repoName}
                            </div>
                            <div className="text-[11px] text-muted-foreground mt-0.5">
                              初始化 {repo.initCallCount} 次 · 同步 {repo.syncCallCount} 次
                            </div>
                          </td>
                          <td className="py-2.5 px-3 text-right tabular-nums">
                            <div className="font-semibold text-blue-600 dark:text-blue-400">
                              {formatNumberWithUnits(repo.initTotalTokens)}
                            </div>
                            <div className="text-[11px] text-muted-foreground">
                              入 {formatNumberWithUnits(repo.initInputTokens)} / 出{" "}
                              {formatNumberWithUnits(repo.initOutputTokens)}
                            </div>
                          </td>
                          <td className="py-2.5 px-3 text-right tabular-nums">
                            <div className="font-semibold text-emerald-600 dark:text-emerald-400">
                              {formatNumberWithUnits(repo.syncTotalTokens)}
                            </div>
                            <div className="text-[11px] text-muted-foreground">
                              入 {formatNumberWithUnits(repo.syncInputTokens)} / 出{" "}
                              {formatNumberWithUnits(repo.syncOutputTokens)}
                            </div>
                          </td>
                          <td className="py-2.5 px-3 text-right tabular-nums text-muted-foreground">
                            {formatNumberWithUnits(repo.cachedInputTokens)}
                          </td>
                          <td className="py-2.5 px-3 text-right tabular-nums min-w-[130px]">
                            <div className="flex items-center justify-end gap-1.5">
                              <span className="font-bold text-foreground">
                                {formatNumberWithUnits(repo.totalTokens)}
                              </span>
                              <span className="text-[11px] text-muted-foreground w-11 text-right">
                                ({formatPercent(pct)})
                              </span>
                            </div>
                            <Progress value={pct} className="h-1 mt-1" />
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* 右栏：各智能体应用 Token 消耗明细 */}
          <div className="xl:col-span-5 space-y-2.5">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold flex items-center gap-1.5">
                <Bot className="h-4 w-4 text-violet-500" />
                各智能体应用 Token 消耗明细
              </h3>
              <span className="text-xs text-muted-foreground">
                共 {agentAppBreakdowns.length} 个智能体应用
              </span>
            </div>

            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b bg-muted/40 text-muted-foreground">
                    <th className="text-left py-2.5 px-3 font-medium">智能体应用</th>
                    <th className="text-right py-2.5 px-3 font-medium">问答次数</th>
                    <th className="text-right py-2.5 px-3 font-medium">输入 / 输出 Token</th>
                    <th className="text-right py-2.5 px-3 font-medium">合计消耗</th>
                  </tr>
                </thead>
                <tbody>
                  {agentAppBreakdowns.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="py-8 text-center text-muted-foreground">
                        暂无智能体应用消耗记录
                      </td>
                    </tr>
                  ) : (
                    agentAppBreakdowns.map((app) => {
                      const appPct =
                        agentAppTotal > 0 ? (app.totalTokens / agentAppTotal) * 100 : 0;
                      return (
                        <tr
                          key={app.id}
                          className="border-b last:border-0 hover:bg-muted/25 transition-colors"
                        >
                          <td className="py-2.5 px-3">
                            <div className="font-semibold text-foreground flex items-center gap-1.5">
                              <span>{app.name}</span>
                              <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">
                                {app.boundRepoCount} 仓库
                              </Badge>
                            </div>
                            <div className="text-[11px] text-muted-foreground font-mono mt-0.5">
                              {app.appId}
                            </div>
                          </td>
                          <td className="py-2.5 px-3 text-right tabular-nums font-medium">
                            {app.requestCount.toLocaleString()} 次
                          </td>
                          <td className="py-2.5 px-3 text-right tabular-nums text-muted-foreground">
                            入 {formatNumberWithUnits(app.inputTokens)} / 出{" "}
                            {formatNumberWithUnits(app.outputTokens)}
                          </td>
                          <td className="py-2.5 px-3 text-right tabular-nums min-w-[110px]">
                            <div className="font-bold text-violet-600 dark:text-violet-400">
                              {formatNumberWithUnits(app.totalTokens)}
                            </div>
                            <Progress value={appPct} className="h-1 mt-1" />
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </Card>

      <section className="grid gap-4 xl:grid-cols-3">
        <ChartPanel
          title={t("admin.dashboard.repoStats")}
          description={t("admin.dashboard.repoStatsDescription")}
          meta={t("admin.dashboard.totalWithCount", {
            count: totalRepoSubmitted,
          })}
        >
          <ResponsiveContainer width="100%" height={260}>
            <BarChart
              data={repoChartData as ChartDatum[]}
              margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
            >
              <CartesianGrid
                stroke="var(--border)"
                strokeDasharray="3 3"
                vertical={false}
              />
              <XAxis
                dataKey="date"
                axisLine={false}
                tickLine={false}
                tick={AXIS_TICK}
              />
              <YAxis axisLine={false} tickLine={false} tick={AXIS_TICK} />
              <Tooltip
                cursor={CURSOR_FILL}
                content={<CustomTooltip totalLabel={t("admin.dashboard.total")} />}
              />
              <Bar
                dataKey="submitted"
                name={t("admin.dashboard.submitCount")}
                fill={CHART_COLORS.submitted}
                radius={[4, 4, 0, 0]}
              />
              <Bar
                dataKey="processed"
                name={t("admin.dashboard.processed")}
                fill={CHART_COLORS.processed}
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </ChartPanel>

        <ChartPanel
          title={t("admin.dashboard.userGrowth")}
          description={t("admin.dashboard.userGrowthDescription")}
          meta={t("admin.dashboard.totalWithCount", { count: totalNewUsers })}
        >
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart
              data={userChartData as ChartDatum[]}
              margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
            >
              <CartesianGrid
                stroke="var(--border)"
                strokeDasharray="3 3"
                vertical={false}
              />
              <XAxis
                dataKey="date"
                axisLine={false}
                tickLine={false}
                tick={AXIS_TICK}
              />
              <YAxis axisLine={false} tickLine={false} tick={AXIS_TICK} />
              <Tooltip
                cursor={CURSOR_FILL}
                content={<CustomTooltip totalLabel={t("admin.dashboard.total")} />}
              />
              <Bar
                dataKey="users"
                name={t("admin.dashboard.newUsers")}
                fill={CHART_COLORS.users}
                radius={[4, 4, 0, 0]}
              />
              <Line
                type="monotone"
                dataKey="users"
                name={t("admin.dashboard.newUsers")}
                stroke="var(--foreground)"
                strokeWidth={2}
                dot={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </ChartPanel>

        <ChartPanel
          title={t("admin.dashboard.mcpTrend")}
          description={t("admin.dashboard.mcpTrendDescription")}
          meta={t("admin.dashboard.errorsWithCount", { count: totalMcpErrors })}
        >
          {mcpStats ? (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart
                data={mcpChartData as ChartDatum[]}
                margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
              >
                <CartesianGrid
                  stroke="var(--border)"
                  strokeDasharray="3 3"
                  vertical={false}
                />
                <XAxis
                  dataKey="date"
                  axisLine={false}
                  tickLine={false}
                  tick={AXIS_TICK}
                />
                <YAxis axisLine={false} tickLine={false} tick={AXIS_TICK} />
                <Tooltip
                  cursor={CURSOR_FILL}
                  content={
                    <CustomTooltip totalLabel={t("admin.dashboard.total")} />
                  }
                />
                <Bar
                  dataKey="requests"
                  name={t("admin.dashboard.mcpRequests")}
                  fill={CHART_COLORS.requests}
                  radius={[4, 4, 0, 0]}
                />
                <Bar
                  dataKey="errors"
                  name={t("admin.dashboard.mcpErrors")}
                  fill={CHART_COLORS.errors}
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <EmptyChartState label={t("admin.dashboard.mcpUnavailable")} />
          )}
        </ChartPanel>
      </section>

      <section className="grid gap-3 md:grid-cols-3">
        <Card className="gap-0 rounded-lg p-4 shadow-none">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Sparkles className="h-4 w-4 text-amber-500" />
            {t("admin.dashboard.cacheCreationToken")}
          </div>
          <p className="mt-2 text-2xl font-semibold tabular-nums">
            {formatNumberWithUnits(totalCacheCreationInputTokens)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("admin.dashboard.cacheCreationTokenDetail")}
          </p>
        </Card>
        <Card className="gap-0 rounded-lg p-4 shadow-none">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Zap className="h-4 w-4 text-emerald-500" />
            {t("admin.dashboard.cacheHitToken")}
          </div>
          <p className="mt-2 text-2xl font-semibold tabular-nums">
            {formatNumberWithUnits(totalCachedInputTokens)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("admin.dashboard.cacheHitTokenDetail")}
          </p>
        </Card>
        <Card className="gap-0 rounded-lg p-4 shadow-none">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Server className="h-4 w-4 text-cyan-500" />
            {t("admin.dashboard.mcpRequests")}
          </div>
          <p className="mt-2 text-2xl font-semibold tabular-nums">
            {totalMcpRequests.toLocaleString()}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("admin.dashboard.mcpRequestMix", {
              success: totalMcpSuccessful,
              errors: totalMcpErrors,
            })}
          </p>
        </Card>
      </section>

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <BarChart3 className="h-3.5 w-3.5" />
        <span>{t("admin.dashboard.windowHint", { days })}</span>
      </div>
    </div>
  );
}
