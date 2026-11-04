"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { AppLayout } from "@/components/app-layout";
import { useTranslations } from "@/hooks/use-translations";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AppWindow,
  Plus,
  Loader2,
  MoreVertical,
  Pencil,
  Trash2,
  Layers,
  Globe,
  Lock,
  Terminal,
} from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { getUserApps, deleteApp, ChatAppDto } from "@/lib/apps-api";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { AppFormDialog } from "@/components/apps/app-form-dialog";

export default function AppsPage() {
  const t = useTranslations();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const [activeItem, setActiveItem] = useState(t("sidebar.apps"));
  const [apps, setApps] = useState<ChatAppDto[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingApp, setEditingApp] = useState<ChatAppDto | null>(null);
  const [deletingApp, setDeletingApp] = useState<ChatAppDto | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const fetchApps = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await getUserApps();
      setApps(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load apps");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      fetchApps();
    } else if (!authLoading && !isAuthenticated) {
      setIsLoading(false);
    }
  }, [authLoading, isAuthenticated, fetchApps]);

  const handleCreateSuccess = useCallback(() => {
    setIsFormOpen(false);
    setEditingApp(null);
    fetchApps();
  }, [fetchApps]);

  const handleEdit = (app: ChatAppDto) => {
    setEditingApp(app);
    setIsFormOpen(true);
  };

  const handleDelete = async () => {
    if (!deletingApp) return;

    setIsDeleting(true);
    try {
      await deleteApp(deletingApp.id);
      setApps((prev) => prev.filter((a) => a.id !== deletingApp.id));
      setDeletingApp(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("apps.detail.deleteFailed"));
    } finally {
      setIsDeleting(false);
    }
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString();
  };

  if (!authLoading && !isAuthenticated) {
    return (
      <AppLayout activeItem={activeItem} onItemClick={setActiveItem}>
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-4 md:p-6">
          <AppWindow className="h-16 w-16 text-muted-foreground" />
          <h2 className="text-xl font-semibold">{t("apps.loginRequired")}</h2>
          <p className="text-muted-foreground">{t("apps.loginHint")}</p>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout activeItem={activeItem} onItemClick={setActiveItem}>
      <div className="flex flex-1 flex-col gap-5 p-4 md:p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1.5">
            <h1 className="text-3xl font-bold tracking-tight">智能体应用（对外知识服务单元）</h1>
            <p className="text-sm text-muted-foreground">
              将前后端多个代码仓库封装为统一的业务智能体，供 <strong>ZtWork 连接器</strong> 与 <strong>MCP 协议</strong> 直接调用，彻底屏蔽底层代码仓库结构。
            </p>
          </div>
          <Button className="gap-2 bg-emerald-600 hover:bg-emerald-500 text-white" onClick={() => setIsFormOpen(true)}>
            <Plus className="h-4 w-4" />
            创建智能体应用
          </Button>
        </div>

        {/* 全局 MCP 与 ZtWork 接入说明栏 */}
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sm font-semibold text-emerald-700 dark:text-emerald-300">
              <Terminal className="h-4 w-4" />
              <span>统一对外接入地址（自动同步所有激活的智能体应用）</span>
            </div>
            <p className="text-xs text-muted-foreground">
              • <strong>MCP 全局端点</strong>：<code className="px-1.5 py-0.5 rounded bg-background border font-mono">/api/mcp</code>（内置 <code>ListAgentApps</code> / <code>AskAgentApp</code> 工具）
              &nbsp;&nbsp;|&nbsp;&nbsp;
              • <strong>单智能体专属 MCP</strong>：<code className="px-1.5 py-0.5 rounded bg-background border font-mono">/api/mcp/app/&#123;appId&#125;</code>
              &nbsp;&nbsp;|&nbsp;&nbsp;
              • <strong>ZtWork 连接器</strong>：<code className="px-1.5 py-0.5 rounded bg-background border font-mono">/api/ztwork/projects</code> &amp; <code className="px-1.5 py-0.5 rounded bg-background border font-mono">/api/ztwork/ask</code>
            </p>
          </div>
        </div>

        {error && (
          <div className="bg-destructive/10 text-destructive px-4 py-2 rounded-md">
            {error}
          </div>
        )}

        {isLoading || authLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : apps.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 gap-4">
            <AppWindow className="h-16 w-16 text-muted-foreground" />
            <h2 className="text-xl font-semibold">{t("apps.empty")}</h2>
            <p className="text-muted-foreground">创建一个智能体应用并勾选它关联的前后端代码仓库即可对外提供服务</p>
            <Button className="gap-2" onClick={() => setIsFormOpen(true)}>
              <Plus className="h-4 w-4" />
              创建智能体应用
            </Button>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {apps.map((app) => {
              const boundRepos = app.boundRepositories || [];
              const readyCount = boundRepos.filter((r) => r.statusName === "Completed").length;
              return (
                <Link key={app.id} href={`/apps/${app.id}`} className="block">
                  <Card className="hover:shadow-lg hover:border-emerald-500/40 transition-all cursor-pointer h-full flex flex-col justify-between">
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <AppWindow className="h-4 w-4 text-emerald-500 flex-shrink-0" />
                            <CardTitle className="text-lg truncate">{app.name}</CardTitle>
                            <Badge variant="outline" className="text-[11px] font-normal">
                              {app.groupName || "业务系统智能体"}
                            </Badge>
                          </div>
                          <CardDescription className="text-xs text-muted-foreground mt-1.5 font-mono truncate">
                            ID: {app.appId}
                          </CardDescription>
                        </div>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 p-0 flex-shrink-0"
                              onClick={(e) => e.preventDefault()}
                            >
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onClick={(e) => {
                                e.preventDefault();
                                handleEdit(app);
                              }}
                            >
                              <Pencil className="h-4 w-4 mr-2" />
                              配置与绑定仓库
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="text-destructive"
                              onClick={(e) => {
                                e.preventDefault();
                                setDeletingApp(app);
                              }}
                            >
                              <Trash2 className="h-4 w-4 mr-2" />
                              {t("common.delete")}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <p className="text-sm text-muted-foreground line-clamp-2">
                        {app.description || `「${app.name}」业务系统智能体，对外提供统一知识问答`}
                      </p>

                      {/* 绑定的底层代码仓库（仅在管理端展示，对外隐藏） */}
                      <div className="rounded-lg bg-muted/40 p-2.5 space-y-1.5">
                        <div className="flex items-center justify-between text-xs">
                          <span className="flex items-center gap-1.5 font-medium text-foreground">
                            <Layers className="h-3.5 w-3.5 text-emerald-500" />
                            底层挂载仓库 ({boundRepos.length})
                          </span>
                          <span className="text-[11px] text-muted-foreground">
                            {readyCount}/{boundRepos.length} 已就绪
                          </span>
                        </div>
                        {boundRepos.length > 0 ? (
                          <div className="flex flex-wrap gap-1.5">
                            {boundRepos.map((r) => (
                              <span
                                key={r.id}
                                className="inline-flex items-center gap-1 rounded bg-background px-2 py-0.5 text-[11px] border"
                              >
                                <span
                                  className={`h-1.5 w-1.5 rounded-full ${
                                    r.statusName === "Completed" ? "bg-emerald-500" : "bg-amber-500"
                                  }`}
                                />
                                {r.orgName}/{r.repoName}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <p className="text-[11px] text-amber-600 dark:text-amber-400">
                            尚未绑定仓库，点击右上角菜单选择代码仓库
                          </p>
                        )}
                      </div>

                      <div className="flex items-center justify-between text-xs text-muted-foreground pt-1 border-t">
                        <div className="flex items-center gap-2">
                          {app.allowedEmployeeNos ? (
                            <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
                              <Lock className="h-3 w-3" />
                              指定工号可见
                            </span>
                          ) : app.isPublic ? (
                            <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                              <Globe className="h-3 w-3" />
                              全员可见
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
                              <Lock className="h-3 w-3" />
                              受限访问
                            </span>
                          )}
                        </div>
                        <span>创建于 {formatDate(app.createdAt)}</span>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </div>
        )}
      </div>

      <AppFormDialog
        open={isFormOpen}
        onOpenChange={(open) => {
          setIsFormOpen(open);
          if (!open) setEditingApp(null);
        }}
        app={editingApp}
        onSuccess={handleCreateSuccess}
      />

      <AlertDialog open={!!deletingApp} onOpenChange={(open) => !open && setDeletingApp(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("apps.detail.deleteApp")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("apps.detail.deleteConfirm")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
