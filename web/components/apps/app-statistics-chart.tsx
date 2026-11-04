"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useTranslations } from "@/hooks/use-translations";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  RefreshCw,
  Activity,
  ArrowDownToLine,
  ArrowUpFromLine,
  Coins,
  BarChart3,
} from "lucide-react";
import {
  getAppStatistics,
  AggregatedStatisticsDto,
  formatDateForApi,
} from "@/lib/apps-api";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  BarChart,
  Bar,
} from "recharts";

interface AppStatisticsChartProps {
  appId: string;
  refreshKey?: number;
}

type DateRange = "7" | "30" | "90";

export function AppStatisticsChart({ appId, refreshKey = 0 }: AppStatisticsChartProps) {
  const t = useTranslations();
  const [statistics, setStatistics] = useState<AggregatedStatisticsDto | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState<DateRange>("7");

  const fetchStatistics = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - (parseInt(dateRange, 10) - 1));

      const data = await getAppStatistics(
        appId,
        formatDateForApi(startDate),
        formatDateForApi(endDate)
      );
      setStatistics(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载统计数据失败");
    } finally {
      setIsLoading(false);
    }
  }, [appId, dateRange]);

  useEffect(() => {
    fetchStatistics();
  }, [fetchStatistics, refreshKey]);

  const formatNumber = (num: number) => {
    if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(2)}M`;
    if (num >= 10_000) return `${(num / 1_000).toFixed(1)}K`;
    return num.toLocaleString();
  };

  // 构建连续日期序列，确保折线图和柱状图即使在单日或少量数据下也有清晰的横轴时间线
  const chartData = useMemo(() => {
    const days = parseInt(dateRange, 10);
    const statMap = new Map<string, { requests: number; inputTokens: number; outputTokens: number }>();

    for (const item of statistics?.dailyStatistics ?? []) {
      const d = new Date(item.date);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const prev = statMap.get(key) ?? { requests: 0, inputTokens: 0, outputTokens: 0 };
      statMap.set(key, {
        requests: prev.requests + item.requestCount,
        inputTokens: prev.inputTokens + item.inputTokens,
        outputTokens: prev.outputTokens + item.outputTokens,
      });
    }

    const result: Array<{
      fullDate: string;
      date: string;
      requests: number;
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
    }> = [];

    const now = new Date();
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const label = `${d.getMonth() + 1}/${d.getDate()}`;
      const matched = statMap.get(key) ?? { requests: 0, inputTokens: 0, outputTokens: 0 };
      result.push({
        fullDate: key,
        date: label,
        requests: matched.requests,
        inputTokens: matched.inputTokens,
        outputTokens: matched.outputTokens,
        totalTokens: matched.inputTokens + matched.outputTokens,
      });
    }

    return result;
  }, [statistics, dateRange]);

  const totalRequests = statistics?.totalRequests ?? 0;
  const totalInputTokens = statistics?.totalInputTokens ?? 0;
  const totalOutputTokens = statistics?.totalOutputTokens ?? 0;
  const totalAllTokens = totalInputTokens + totalOutputTokens;
  const avgTokensPerRequest = totalRequests > 0 ? Math.round(totalAllTokens / totalRequests) : 0;
  const todayRequests = chartData.length > 0 ? chartData[chartData.length - 1].requests : 0;

  if (isLoading && !statistics) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="py-10 flex flex-col items-center justify-center gap-3">
          <div className="text-sm text-destructive">{error}</div>
          <Button variant="outline" size="sm" onClick={fetchStatistics}>
            <RefreshCw className="h-4 w-4 mr-1.5" />
            重试加载
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* 顶部工具栏：时间范围切换 + 刷新 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-muted-foreground">
            统计周期：
          </span>
          <div className="flex items-center gap-1 rounded-lg border bg-muted/30 p-1">
            <Button
              variant={dateRange === "7" ? "default" : "ghost"}
              size="sm"
              className="h-7 px-3 text-xs"
              onClick={() => setDateRange("7")}
            >
              {t("apps.statistics.last7Days")}
            </Button>
            <Button
              variant={dateRange === "30" ? "default" : "ghost"}
              size="sm"
              className="h-7 px-3 text-xs"
              onClick={() => setDateRange("30")}
            >
              {t("apps.statistics.last30Days")}
            </Button>
            <Button
              variant={dateRange === "90" ? "default" : "ghost"}
              size="sm"
              className="h-7 px-3 text-xs"
              onClick={() => setDateRange("90")}
            >
              {t("apps.statistics.last90Days")}
            </Button>
          </div>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={fetchStatistics}
          disabled={isLoading}
        >
          <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${isLoading ? "animate-spin" : ""}`} />
          刷新统计
        </Button>
      </div>

      {/* 4 个核心指标卡片（始终展示） */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-xs font-medium text-muted-foreground">
              周期总提问次数
            </CardTitle>
            <Activity className="h-4 w-4 text-emerald-500" />
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline justify-between">
              <div className="text-2xl font-bold">{formatNumber(totalRequests)}</div>
              <Badge variant="secondary" className="text-xs font-normal">
                今日 {todayRequests} 次
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              含 ZtWork 连接器、MCP 与控制台调用
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-xs font-medium text-muted-foreground">
              输入 Token 消耗 (Prompt)
            </CardTitle>
            <ArrowDownToLine className="h-4 w-4 text-sky-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatNumber(totalInputTokens)}</div>
            <p className="text-xs text-muted-foreground mt-1">
              知识库检索上下文与用户提问输入
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-xs font-medium text-muted-foreground">
              输出 Token 消耗 (Completion)
            </CardTitle>
            <ArrowUpFromLine className="h-4 w-4 text-emerald-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatNumber(totalOutputTokens)}</div>
            <p className="text-xs text-muted-foreground mt-1">
              智能体生成的接口方案与技术解答
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-xs font-medium text-muted-foreground">
              平均单次问答消耗
            </CardTitle>
            <Coins className="h-4 w-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline justify-between">
              <div className="text-2xl font-bold">{formatNumber(avgTokensPerRequest)}</div>
              <span className="text-xs text-muted-foreground">Tokens / 次</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              累计总消耗：{formatNumber(totalAllTokens)} Tokens
            </p>
          </CardContent>
        </Card>
      </div>

      {/* 图表区域 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* 每日问答请求趋势 */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <BarChart3 className="h-4 w-4 text-emerald-500" />
                  {t("apps.statistics.dailyRequests")}
                </CardTitle>
                <CardDescription className="text-xs">
                  按日统计智能体应用接收到的问答调用次数
                </CardDescription>
              </div>
              {totalRequests === 0 && (
                <Badge variant="outline" className="text-xs text-muted-foreground">
                  暂无调用数据
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <div className="h-[260px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.35} />
                  <XAxis dataKey="date" fontSize={12} tickLine={false} />
                  <YAxis allowDecimals={false} fontSize={12} tickLine={false} />
                  <Tooltip
                    formatter={(val) => [`${val ?? 0} 次`, "问答请求数"]}
                    labelFormatter={(label) => `日期: ${label}`}
                  />
                  <Bar
                    dataKey="requests"
                    fill="#10b981"
                    radius={[4, 4, 0, 0]}
                    maxBarSize={36}
                    name={t("apps.statistics.totalRequests")}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* 每日 Token 消耗趋势 */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <Coins className="h-4 w-4 text-sky-500" />
                  {t("apps.statistics.dailyTokens")}
                </CardTitle>
                <CardDescription className="text-xs">
                  每日输入上下文 Token 与生成回答输出 Token 对比
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="h-[260px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.35} />
                  <XAxis dataKey="date" fontSize={12} tickLine={false} />
                  <YAxis fontSize={12} tickLine={false} />
                  <Tooltip />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="inputTokens"
                    stroke="#0ea5e9"
                    name={t("apps.statistics.totalInputTokens")}
                    strokeWidth={2}
                    dot={{ r: 3 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="outputTokens"
                    stroke="#10b981"
                    name={t("apps.statistics.totalOutputTokens")}
                    strokeWidth={2}
                    dot={{ r: 3 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
