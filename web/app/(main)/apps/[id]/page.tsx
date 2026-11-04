"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { AppLayout } from "@/components/app-layout";
import { useTranslations } from "@/hooks/use-translations";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  Loader2,
  Copy,
  Eye,
  EyeOff,
  RefreshCw,
  Pencil,
  Trash2,
  Layers,
  Terminal,
  Check,
  Send,
  Sparkles,
  ExternalLink,
} from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import {
  getAppById,
  deleteApp,
  regenerateAppSecret,
  askAppOnline,
  OnlineAskProjectResult,
  ChatAppDto,
} from "@/lib/apps-api";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { AppFormDialog, AppStatisticsChart, AppLogsTable } from "@/components/apps";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function AppDetailPage() {
  const t = useTranslations();
  const router = useRouter();
  const params = useParams();
  const appId = params.id as string;
  const { isAuthenticated, isLoading: authLoading } = useAuth();

  const [activeItem, setActiveItem] = useState(t("sidebar.apps"));
  const [app, setApp] = useState<ChatAppDto | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showSecret, setShowSecret] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showRegenerateDialog, setShowRegenerateDialog] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [statsRefreshKey, setStatsRefreshKey] = useState(0);
  const [testQuestion, setTestQuestion] = useState("");
  const [isAsking, setIsAsking] = useState(false);
  const [askResult, setAskResult] = useState<OnlineAskProjectResult | null>(null);
  const [askError, setAskError] = useState<string | null>(null);

  const handleOnlineAsk = async (presetQuestion?: string) => {
    if (!app) return;
    const q = (presetQuestion ?? testQuestion).trim();
    if (!q) return;
    if (presetQuestion) setTestQuestion(presetQuestion);
    setIsAsking(true);
    setAskError(null);
    try {
      const res = await askAppOnline(app.id, q);
      setAskResult(res.result);
      setStatsRefreshKey((k) => k + 1);
    } catch (err) {
      setAskError(err instanceof Error ? err.message : "在线问答请求失败");
    } finally {
      setIsAsking(false);
    }
  };

  const fetchApp = useCallback(async () => {
    if (!appId) return;
    setIsLoading(true);
    setError(null);
    try {
      const data = await getAppById(appId);
      setApp(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "App not found");
    } finally {
      setIsLoading(false);
    }
  }, [appId]);

  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      fetchApp();
    } else if (!authLoading && !isAuthenticated) {
      setIsLoading(false);
    }
  }, [authLoading, isAuthenticated, fetchApp]);

  const handleCopy = async (text: string, key = "default") => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1800);
    } catch {
      setError(t("apps.detail.copyFailed"));
    }
  };

  const handleRegenerateSecret = async () => {
    if (!app) return;
    setIsRegenerating(true);
    try {
      const result = await regenerateAppSecret(app.id);
      setApp((prev) => (prev ? { ...prev, appSecret: result.appSecret } : null));
      setShowRegenerateDialog(false);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t("apps.detail.regenerateFailed")
      );
    } finally {
      setIsRegenerating(false);
    }
  };

  const handleDelete = async () => {
    if (!app) return;
    setIsDeleting(true);
    try {
      await deleteApp(app.id);
      router.push("/apps");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t("apps.detail.deleteFailed")
      );
    } finally {
      setIsDeleting(false);
    }
  };

  const handleEditSuccess = () => {
    setIsFormOpen(false);
    fetchApp();
  };

  const baseUrl = typeof window !== "undefined" ? window.location.origin : "http://192.168.185.140:3002";

  const getMcpConfigJson = () => {
    if (!app) return "";
    return JSON.stringify(
      {
        mcpServers: {
          [`openwiki-${app.name}`]: {
            type: "streamable-http",
            url: `${baseUrl}/api/mcp/app/${app.appId}`,
          },
        },
      },
      null,
      2
    );
  };

  const getZtWorkAskExample = () => {
    if (!app) return "";
    return `curl -X POST "${baseUrl}/api/ztwork/ask" \\
  -H "Authorization: Bearer <ZtWork_Token>" \\
  -H "Content-Type: application/json" \\
  -H "X-ZtWork-Connector: 1" \\
  -d '{
    "requestId": "req-001",
    "question": "请结合本系统知识库给出相关接口方案",
    "projectIds": ["${app.appId}"]
  }'`;
  };

  if (!authLoading && !isAuthenticated) {
    return (
      <AppLayout activeItem={activeItem} onItemClick={setActiveItem}>
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-4 md:p-6">
          <p className="text-muted-foreground">{t("apps.loginRequired")}</p>
        </div>
      </AppLayout>
    );
  }

  if (isLoading || authLoading) {
    return (
      <AppLayout activeItem={activeItem} onItemClick={setActiveItem}>
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </AppLayout>
    );
  }

  if (!app) {
    return (
      <AppLayout activeItem={activeItem} onItemClick={setActiveItem}>
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-4 md:p-6">
          <p className="text-muted-foreground">{t("apps.detail.notFound")}</p>
          <Button variant="outline" onClick={() => router.push("/apps")}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            {t("apps.detail.backToList")}
          </Button>
        </div>
      </AppLayout>
    );
  }

  const boundRepos = app.boundRepositories || [];

  return (
    <AppLayout activeItem={activeItem} onItemClick={setActiveItem}>
      <div className="flex flex-1 flex-col gap-4 p-4 md:p-6">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => router.push("/apps")}
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              {t("apps.detail.backToList")}
            </Button>
            <div>
              <div className="flex items-center gap-2.5">
                <h1 className="text-2xl font-bold">{app.name}</h1>
                <Badge variant="outline">{app.groupName || "业务系统智能体"}</Badge>
                <Badge className={app.isActive ? "bg-emerald-600 text-white" : "bg-muted text-muted-foreground"}>
                  {app.isActive ? "运行中" : "已停用"}
                </Badge>
              </div>
              {app.description && (
                <p className="text-sm text-muted-foreground mt-1">{app.description}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setIsFormOpen(true)}>
              <Pencil className="h-4 w-4 mr-2" />
              编辑与挂载仓库
            </Button>
            <Button
              variant="destructive"
              onClick={() => setShowDeleteDialog(true)}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              {t("common.delete")}
            </Button>
          </div>
        </div>

        {error && (
          <div className="bg-destructive/10 text-destructive px-4 py-2 rounded-md">
            {error}
          </div>
        )}

        {/* 挂载的知识库仓库列表 */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Layers className="h-4 w-4 text-emerald-500" />
              底层挂载的知识库代码仓库（共 {boundRepos.length} 个，对外部调用方透明屏蔽）
            </CardTitle>
            <CardDescription>
              外部客户端（ZtWork 或 MCP）向「{app.name}」提问时，智能体会自动在以下所有挂载仓库的 Wiki 文档中联合检索并生成回答。
            </CardDescription>
          </CardHeader>
          <CardContent>
            {boundRepos.length === 0 ? (
              <div className="flex items-center justify-between rounded-lg border border-dashed p-4">
                <span className="text-sm text-muted-foreground">尚未绑定代码仓库</span>
                <Button size="sm" variant="outline" onClick={() => setIsFormOpen(true)}>
                  立即绑定仓库
                </Button>
              </div>
            ) : (
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                {boundRepos.map((repo) => (
                  <div
                    key={repo.id}
                    className="flex items-center justify-between rounded-lg border p-3 bg-muted/20"
                  >
                    <div>
                      <div className="text-sm font-semibold">
                        {repo.orgName} / {repo.repoName}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        仓库 ID: {repo.id.slice(0, 8)}...
                      </div>
                    </div>
                    <Badge
                      variant="outline"
                      className={
                        repo.statusName === "Completed"
                          ? "border-emerald-500/40 text-emerald-500"
                          : "border-amber-500/40 text-amber-500"
                      }
                    >
                      {repo.statusName === "Completed" ? "索引就绪" : "索引构建中"}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* 对外接入方式：MCP + ZtWork 连接器 */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Terminal className="h-5 w-5 text-emerald-500" />
              外部接入配置（MCP 协议 &amp; ZtWork 连接器）
            </CardTitle>
            <CardDescription>
              支持直接通过标准 MCP 协议接入，或通过 ZtWork 连接器规范接入，两种方式均直接与本智能体应用对话。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* App ID & Secret */}
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-medium">
                  智能体应用 ID（ZtWork projectId / MCP appId）
                </label>
                <div className="flex items-center gap-2">
                  <Input value={app.appId} readOnly className="font-mono" />
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => handleCopy(app.appId, "appId")}
                  >
                    {copiedKey === "appId" ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">
                  {t("apps.detail.appSecret")}
                </label>
                <div className="flex items-center gap-2">
                  <Input
                    type={showSecret ? "text" : "password"}
                    value={app.appSecret || ""}
                    readOnly
                    className="font-mono"
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => setShowSecret(!showSecret)}
                  >
                    {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => app.appSecret && handleCopy(app.appSecret, "secret")}
                  >
                    {copiedKey === "secret" ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setShowRegenerateDialog(true)}
                    disabled={isRegenerating}
                  >
                    {isRegenerating ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>
            </div>

            {/* 方式 1：MCP 接入 */}
            <div className="space-y-2 border-t pt-4">
              <div className="flex items-center justify-between">
                <label className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                  方式一：通过 MCP 协议直接调用本智能体应用（Streamable HTTP）
                </label>
                <span className="text-xs text-muted-foreground">
                  内置工具：<code>AskAgentApp</code>（直接向智能体提问并获取方案）、<code>ListAgentApps</code>
                </span>
              </div>
              <div className="relative">
                <pre className="bg-muted p-4 rounded-md overflow-x-auto text-xs font-mono">
                  <code>{getMcpConfigJson()}</code>
                </pre>
                <Button
                  variant="outline"
                  size="sm"
                  className="absolute top-2 right-2"
                  onClick={() => handleCopy(getMcpConfigJson(), "mcp")}
                >
                  {copiedKey === "mcp" ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
            </div>

            {/* 方式 2：ZtWork 连接器调用 */}
            <div className="space-y-2 border-t pt-4">
              <div className="flex items-center justify-between">
                <label className="text-sm font-semibold">
                  方式二：通过 ZtWork 连接器接口调用本智能体应用（/api/ztwork/ask）
                </label>
                <span className="text-xs text-muted-foreground">
                  在 ZtWork 项目列表中自动展示为「{app.name}」
                </span>
              </div>
              <div className="relative">
                <pre className="bg-muted p-4 rounded-md overflow-x-auto text-xs font-mono">
                  <code>{getZtWorkAskExample()}</code>
                </pre>
                <Button
                  variant="outline"
                  size="sm"
                  className="absolute top-2 right-2"
                  onClick={() => handleCopy(getZtWorkAskExample(), "ztwork")}
                >
                  {copiedKey === "ztwork" ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
            </div>

            {/* Configuration Summary */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-4 border-t">
              <div>
                <p className="text-sm text-muted-foreground">模型提供商类型</p>
                <p className="font-medium">{app.providerType || "系统默认"}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">默认模型</p>
                <p className="font-medium">{app.defaultModel || "跟随系统全局模型"}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">访问权限</p>
                <p className="font-medium">
                  {app.allowedEmployeeNos
                    ? `白名单工号 (${app.allowedEmployeeNos})`
                    : app.isPublic
                      ? "全员可见"
                      : "仅管理员/所有者"}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">挂载仓库数</p>
                <p className="font-medium">{boundRepos.length} 个代码仓库</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Statistics, Logs and Playground Tabs */}
        <Tabs defaultValue="statistics" className="w-full">
          <TabsList>
            <TabsTrigger value="statistics">
              {t("apps.statistics.title")}
            </TabsTrigger>
            <TabsTrigger value="logs">{t("apps.logs.title")}</TabsTrigger>
            <TabsTrigger value="playground">
              在线问答测试
            </TabsTrigger>
          </TabsList>
          <TabsContent value="statistics" className="mt-4">
            <AppStatisticsChart appId={app.id} refreshKey={statsRefreshKey} />
          </TabsContent>
          <TabsContent value="logs" className="mt-4">
            <AppLogsTable appId={app.id} refreshKey={statsRefreshKey} />
          </TabsContent>
          <TabsContent value="playground" className="mt-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-emerald-500" />
                  向「{app.name}」发起在线问答测试
                </CardTitle>
                <CardDescription className="text-xs">
                  模拟 ZtWork 连接器与 MCP 客户端调用本智能体应用，自动检索底层挂载的前后端仓库知识库，并将调用计入「使用统计」与「提问记录」。
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-muted-foreground">快捷提问示例：</span>
                  {[
                    `请介绍「${app.name}」系统的整体架构与核心业务模块`,
                    `「${app.name}」前后端核心接口与鉴权流程是怎么设计的？`,
                    `我需要对接「${app.name}」的业务单据接口，请给出方案与字段说明`,
                  ].map((sample, idx) => (
                    <Button
                      key={idx}
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      disabled={isAsking}
                      onClick={() => handleOnlineAsk(sample)}
                    >
                      {sample}
                    </Button>
                  ))}
                </div>

                <div className="flex items-center gap-2">
                  <Input
                    value={testQuestion}
                    onChange={(e) => setTestQuestion(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !isAsking) {
                        handleOnlineAsk();
                      }
                    }}
                    placeholder={`向「${app.name}」提问，例如：请给出相关接口方案...`}
                    disabled={isAsking}
                  />
                  <Button
                    onClick={() => handleOnlineAsk()}
                    disabled={isAsking || !testQuestion.trim()}
                    className="bg-emerald-600 hover:bg-emerald-500 text-white shrink-0"
                  >
                    {isAsking ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                        检索生成中...
                      </>
                    ) : (
                      <>
                        <Send className="h-4 w-4 mr-1.5" />
                        发送提问
                      </>
                    )}
                  </Button>
                </div>

                {askError && (
                  <div className="rounded-md bg-destructive/10 text-destructive px-3 py-2 text-xs">
                    {askError}
                  </div>
                )}

                {askResult && (
                  <div className="space-y-3 rounded-lg border bg-muted/20 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-2.5">
                      <div className="flex items-center gap-2">
                        <Badge
                          className={
                            askResult.status === "answered"
                              ? "bg-emerald-600 text-white"
                              : "bg-amber-600 text-white"
                          }
                        >
                          {askResult.status === "answered" ? "已解答 (answered)" : `状态: ${askResult.status}`}
                        </Badge>
                        <Badge variant="outline" className="text-xs">
                          相关度: {(askResult.relevance * 100).toFixed(0)}%
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          耗时 {askResult.durationMs} ms
                        </span>
                      </div>
                      {askResult.usage && (
                        <span className="text-xs text-muted-foreground font-mono">
                          Tokens: 入 {askResult.usage.inputTokens} / 出 {askResult.usage.outputTokens}
                        </span>
                      )}
                    </div>

                    <div className="space-y-1">
                      <div className="text-xs font-semibold text-muted-foreground">方案结论摘要 (Summary)</div>
                      <div className="text-sm font-medium">{askResult.summary}</div>
                    </div>

                    <div className="space-y-1">
                      <div className="text-xs font-semibold text-muted-foreground">详细方案回答 (Answer)</div>
                      <div className="rounded-md border bg-background p-3 text-xs whitespace-pre-wrap leading-relaxed max-h-[360px] overflow-y-auto">
                        {askResult.answer}
                      </div>
                    </div>

                    {askResult.sources && askResult.sources.length > 0 && (
                      <div className="space-y-1.5 pt-1">
                        <div className="text-xs font-semibold text-muted-foreground">
                          命中的知识库文档来源 ({askResult.sources.length} 篇)
                        </div>
                        <div className="grid gap-2 sm:grid-cols-2">
                          {askResult.sources.slice(0, 6).map((src, i) => (
                            <a
                              key={i}
                              href={src.url}
                              target="_blank"
                              rel="noreferrer"
                              className="flex items-center justify-between rounded border bg-background px-2.5 py-1.5 text-xs hover:border-emerald-500/50 transition-colors"
                            >
                              <span className="truncate font-medium">{src.title}</span>
                              <ExternalLink className="h-3 w-3 text-muted-foreground shrink-0 ml-2" />
                            </a>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      <AppFormDialog
        open={isFormOpen}
        onOpenChange={setIsFormOpen}
        app={app}
        onSuccess={handleEditSuccess}
      />

      <AlertDialog
        open={showRegenerateDialog}
        onOpenChange={setShowRegenerateDialog}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("apps.detail.regenerateSecret")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("apps.detail.regenerateConfirm")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isRegenerating}>
              {t("common.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRegenerateSecret}
              disabled={isRegenerating}
            >
              {isRegenerating && (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              )}
              {t("common.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("apps.detail.deleteApp")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("apps.detail.deleteConfirm")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>
              {t("common.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
