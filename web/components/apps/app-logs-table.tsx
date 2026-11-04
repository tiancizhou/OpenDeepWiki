"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "@/hooks/use-translations";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Loader2,
  Search,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  User,
  MessageSquareText,
  Eye,
  Cpu,
  Copy,
  Check,
} from "lucide-react";
import {
  getAppLogs,
  PaginatedChatLogsDto,
  ChatLogDto,
} from "@/lib/apps-api";

interface AppLogsTableProps {
  appId: string;
  refreshKey?: number;
}

export function AppLogsTable({ appId, refreshKey = 0 }: AppLogsTableProps) {
  const t = useTranslations();
  const [logs, setLogs] = useState<PaginatedChatLogsDto | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [keyword, setKeyword] = useState("");
  const [searchKeyword, setSearchKeyword] = useState("");
  const [channelFilter, setChannelFilter] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [selectedLog, setSelectedLog] = useState<ChatLogDto | null>(null);
  const [copiedAnswer, setCopiedAnswer] = useState(false);
  const pageSize = 10;

  const fetchLogs = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const effectiveKeyword = [
        searchKeyword.trim(),
        channelFilter !== "all" ? channelFilter : "",
      ]
        .filter(Boolean)
        .join(" ");

      const data = await getAppLogs(appId, {
        keyword: effectiveKeyword || undefined,
        page,
        pageSize,
      });
      setLogs(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载提问记录失败");
    } finally {
      setIsLoading(false);
    }
  }, [appId, searchKeyword, channelFilter, page]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs, refreshKey]);

  const handleSearch = () => {
    setSearchKeyword(keyword);
    setPage(1);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSearch();
    }
  };

  const formatDateTime = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  };

  const renderChannelBadge = (sourceDomain?: string) => {
    const raw = (sourceDomain || "").trim();
    if (!raw || raw.toLowerCase().includes("ztwork")) {
      return (
        <Badge variant="outline" className="border-emerald-500/40 text-emerald-600 dark:text-emerald-400 text-xs">
          ZtWork 连接器
        </Badge>
      );
    }
    if (raw.toLowerCase().includes("mcp")) {
      return (
        <Badge variant="outline" className="border-sky-500/40 text-sky-600 dark:text-sky-400 text-xs">
          MCP 协议
        </Badge>
      );
    }
    if (raw.includes("控制台") || raw.toLowerCase().includes("web")) {
      return (
        <Badge variant="outline" className="border-violet-500/40 text-violet-600 dark:text-violet-400 text-xs">
          控制台测试
        </Badge>
      );
    }
    return (
      <Badge variant="outline" className="text-xs">
        {raw}
      </Badge>
    );
  };

  const parseAnswerSummary = (raw?: string) => {
    if (!raw) {
      return {
        isNotRelevant: false,
        summaryText: "-",
        fullAnswerText: "-",
        hasSeparateSummary: false,
      };
    }
    const trimmed = raw.trim();
    if (trimmed.startsWith("[判定无关]") || trimmed.startsWith("[无相关内容]")) {
      const cleaned = trimmed.replace(/^\[(判定无关|无相关内容)\]\s*/, "");
      return {
        isNotRelevant: true,
        summaryText: cleaned,
        fullAnswerText: cleaned,
        hasSeparateSummary: false,
      };
    }
    if (trimmed.startsWith("【结论概要】")) {
      const withoutPrefix = trimmed.replace(/^【结论概要】\s*/, "");
      const sepIndex = withoutPrefix.indexOf("\n\n");
      if (sepIndex !== -1) {
        const summaryLine = withoutPrefix.slice(0, sepIndex).trim();
        const body = withoutPrefix.slice(sepIndex + 2).trim();
        return {
          isNotRelevant: false,
          summaryText: summaryLine || body,
          fullAnswerText: body || summaryLine,
          hasSeparateSummary: Boolean(summaryLine && body && summaryLine !== body),
        };
      }
      return {
        isNotRelevant: false,
        summaryText: withoutPrefix,
        fullAnswerText: withoutPrefix,
        hasSeparateSummary: false,
      };
    }

    const firstLine =
      trimmed
        .split("\n")
        .map((l) => l.replace(/^#+\s*/, "").trim())
        .find((l) => l.length > 0) || trimmed;

    return {
      isNotRelevant: false,
      summaryText: firstLine,
      fullAnswerText: trimmed,
      hasSeparateSummary: false,
    };
  };

  const handleCopyFullAnswer = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedAnswer(true);
      setTimeout(() => setCopiedAnswer(false), 2000);
    } catch {
      // ignore
    }
  };

  if (isLoading && !logs) {
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
          <Button variant="outline" size="sm" onClick={fetchLogs}>
            <RefreshCw className="h-4 w-4 mr-1.5" />
            重试加载
          </Button>
        </CardContent>
      </Card>
    );
  }

  const selectedParsed = selectedLog ? parseAnswerSummary(selectedLog.answerSummary) : null;

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <MessageSquareText className="h-4 w-4 text-emerald-500" />
                问答审计与调用记录
              </CardTitle>
              <CardDescription className="text-xs mt-0.5">
                记录通过 ZtWork 连接器、MCP 协议及控制台测试发起的每一次智能体提问、关联员工工号与完整真实回答
              </CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={fetchLogs}
              disabled={isLoading}
            >
              <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${isLoading ? "animate-spin" : ""}`} />
              刷新记录
            </Button>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* 搜索与渠道筛选栏 */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 flex-1 min-w-[260px] max-w-md">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="搜索提问内容、智能体回答或员工工号..."
                  className="pl-9 h-9 text-sm"
                />
              </div>
              <Button size="sm" className="h-9" onClick={handleSearch} disabled={isLoading}>
                {isLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  t("common.search")
                )}
              </Button>
            </div>

            <div className="flex items-center gap-1 rounded-lg border bg-muted/30 p-1">
              {[
                { key: "all", label: "全部渠道" },
                { key: "ZtWork", label: "ZtWork 连接器" },
                { key: "MCP", label: "MCP 协议" },
                { key: "控制台", label: "控制台测试" },
              ].map((item) => (
                <Button
                  key={item.key}
                  variant={channelFilter === item.key ? "default" : "ghost"}
                  size="sm"
                  className="h-7 px-2.5 text-xs"
                  onClick={() => {
                    setChannelFilter(item.key);
                    setPage(1);
                  }}
                >
                  {item.label}
                </Button>
              ))}
            </div>
          </div>

          {/* 表格内容 */}
          {!logs || logs.items.length === 0 ? (
            <div className="rounded-lg border border-dashed py-12 text-center">
              <MessageSquareText className="h-8 w-8 text-muted-foreground/50 mx-auto mb-2" />
              <div className="text-sm font-medium text-muted-foreground">
                {t("apps.logs.noLogs")}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                可在切换到「在线对话测试」标签页直接发起提问，或通过 ZtWork / MCP 客户端调用后查看记录
              </p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/40 text-muted-foreground">
                      <th className="text-left py-2.5 px-3 font-medium">提问人 / 工号</th>
                      <th className="text-left py-2.5 px-3 font-medium">接入渠道</th>
                      <th className="text-left py-2.5 px-3 font-medium">提问内容</th>
                      <th className="text-left py-2.5 px-3 font-medium">智能体回复内容</th>
                      <th className="text-left py-2.5 px-3 font-medium">模型与 Token</th>
                      <th className="text-left py-2.5 px-3 font-medium">提问时间</th>
                      <th className="text-right py-2.5 px-3 font-medium">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.items.map((log) => {
                      const parsed = parseAnswerSummary(log.answerSummary);
                      return (
                        <tr
                          key={log.id}
                          className="border-b last:border-0 hover:bg-muted/30 transition-colors cursor-pointer"
                          onClick={() => setSelectedLog(log)}
                        >
                          <td className="py-3 px-3 whitespace-nowrap">
                            <div className="flex items-center gap-1.5 font-medium">
                              <User className="h-3.5 w-3.5 text-muted-foreground" />
                              <span>{log.userIdentifier || "匿名调用"}</span>
                            </div>
                          </td>
                          <td className="py-3 px-3 whitespace-nowrap">
                            {renderChannelBadge(log.sourceDomain)}
                          </td>
                          <td className="py-3 px-3 max-w-[260px]">
                            <div className="line-clamp-2 font-medium text-foreground" title={log.question}>
                              {log.question}
                            </div>
                          </td>
                          <td className="py-3 px-3 max-w-[320px]">
                            <div className="flex items-start gap-1.5">
                              <Badge
                                variant="secondary"
                                className={
                                  parsed.isNotRelevant
                                    ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 shrink-0 text-[11px]"
                                    : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 shrink-0 text-[11px]"
                                }
                              >
                                {parsed.isNotRelevant ? "判定无关" : "已解答"}
                              </Badge>
                              <div className="min-w-0">
                                <span
                                  className="line-clamp-2 text-xs text-muted-foreground"
                                  title={parsed.summaryText}
                                >
                                  {parsed.summaryText}
                                </span>
                                {parsed.fullAnswerText.length > 120 && (
                                  <span className="text-[11px] text-emerald-600 dark:text-emerald-400">
                                    点击查看完整回复（{parsed.fullAnswerText.length} 字）
                                  </span>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="py-3 px-3 whitespace-nowrap">
                            <div className="flex flex-col gap-0.5">
                              <span className="text-xs font-mono flex items-center gap-1">
                                <Cpu className="h-3 w-3 text-muted-foreground" />
                                {log.modelUsed || "wiki-rag"}
                              </span>
                              <span className="text-[11px] text-muted-foreground">
                                输入 {log.inputTokens} / 输出 {log.outputTokens}
                              </span>
                            </div>
                          </td>
                          <td className="py-3 px-3 text-xs text-muted-foreground whitespace-nowrap">
                            {formatDateTime(log.createdAt)}
                          </td>
                          <td
                            className="py-3 px-3 text-right whitespace-nowrap"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-xs"
                              onClick={() => setSelectedLog(log)}
                            >
                              <Eye className="h-3.5 w-3.5 mr-1" />
                              查看完整回答
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* 分页栏 */}
              <div className="flex items-center justify-between pt-2">
                <div className="text-xs text-muted-foreground">
                  共 <span className="font-medium text-foreground">{logs.totalCount}</span> 条提问记录
                </div>
                {logs.totalPages > 1 && (
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8"
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      disabled={page === 1 || isLoading}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <span className="text-xs">
                      第 {page} / {logs.totalPages} 页
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8"
                      onClick={() => setPage((p) => p + 1)}
                      disabled={page >= logs.totalPages || isLoading}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* 提问记录详情弹窗 */}
      <Dialog open={!!selectedLog} onOpenChange={(open) => !open && setSelectedLog(null)}>
        <DialogContent className="max-w-4xl max-h-[88vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>提问记录详情</DialogTitle>
            <DialogDescription>
              查看本次智能体问答的完整问题、结论概要与智能体真实完整回答内容
            </DialogDescription>
          </DialogHeader>
          {selectedLog && selectedParsed && (
            <div className="space-y-4 text-sm overflow-y-auto pr-1">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 rounded-lg border bg-muted/30 p-3">
                <div>
                  <div className="text-xs text-muted-foreground">提问人 / 工号</div>
                  <div className="font-medium mt-0.5">{selectedLog.userIdentifier || "匿名调用"}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">接入渠道</div>
                  <div className="mt-0.5">{renderChannelBadge(selectedLog.sourceDomain)}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">调用模型</div>
                  <div className="font-mono text-xs mt-0.5">{selectedLog.modelUsed || "wiki-rag"}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Token 消耗</div>
                  <div className="text-xs mt-0.5">
                    入 {selectedLog.inputTokens} / 出 {selectedLog.outputTokens}
                  </div>
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="text-xs font-semibold text-muted-foreground">用户提问内容</div>
                <div className="rounded-md border bg-muted/20 p-3 whitespace-pre-wrap leading-relaxed">
                  {selectedLog.question}
                </div>
              </div>

              {selectedParsed.hasSeparateSummary && (
                <div className="space-y-1.5">
                  <div className="text-xs font-semibold text-muted-foreground">结论概要（Summary）</div>
                  <div className="rounded-md border border-emerald-500/20 bg-emerald-500/5 p-2.5 text-xs leading-relaxed">
                    {selectedParsed.summaryText}
                  </div>
                </div>
              )}

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-semibold text-muted-foreground">
                    智能体真实完整回答（共 {selectedParsed.fullAnswerText.length} 字）
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 px-2.5 text-xs"
                    onClick={() => handleCopyFullAnswer(selectedParsed.fullAnswerText)}
                  >
                    {copiedAnswer ? (
                      <>
                        <Check className="h-3.5 w-3.5 mr-1 text-emerald-500" />
                        已复制
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5 mr-1" />
                        复制完整回答
                      </>
                    )}
                  </Button>
                </div>
                <div className="rounded-md border bg-muted/20 p-4 whitespace-pre-wrap leading-relaxed font-sans max-h-[45vh] overflow-y-auto">
                  {selectedParsed.fullAnswerText || "-"}
                </div>
              </div>

              <div className="text-xs text-muted-foreground text-right">
                记录时间：{formatDateTime(selectedLog.createdAt)}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
