"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { RepositoryItemResponse } from "@/types/repository";
import { buildRepoBasePath } from "@/lib/repo-route";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Layers,
  GitBranch,
  CheckCircle2,
  Loader2,
  Clock,
  XCircle,
  Copy,
  ArrowUpRight,
  Code2,
  Server,
  Monitor,
  Boxes,
  Pencil,
  Check,
  X,
  Users,
} from "lucide-react";
import { toast } from "sonner";

interface RepositoryGroupViewProps {
  repositories: RepositoryItemResponse[];
  emptyMessage?: string;
  renderActions?: (repo: RepositoryItemResponse) => React.ReactNode;
}

function inferRepoRole(repo: RepositoryItemResponse): {
  label: string;
  tone: string;
  icon: typeof Monitor;
} {
  const name = repo.repoName.toLowerCase();
  const lang = (repo.primaryLanguage || "").toLowerCase();

  if (
    name.includes("front") ||
    name.includes("web") ||
    name.includes("h5") ||
    name.includes("saber") ||
    name.includes("ui") ||
    name.includes("client") ||
    name.includes("admin-fe") ||
    lang === "vue" ||
    lang === "html" ||
    lang === "css"
  ) {
    return {
      label: "前端",
      tone: "bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20",
      icon: Monitor,
    };
  }

  if (
    name.includes("back") ||
    name.includes("server") ||
    name.includes("api") ||
    name.includes("blade") ||
    name.includes("biz") ||
    name.includes("service") ||
    name.includes("core") ||
    name.includes("boot") ||
    lang === "java" ||
    lang === "c#" ||
    lang === "go" ||
    lang === "rust"
  ) {
    return {
      label: "后端",
      tone: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
      icon: Server,
    };
  }

  return {
    label: "模块",
    tone: "bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/20",
    icon: Boxes,
  };
}

function getStatusDisplay(repo: RepositoryItemResponse) {
  const status = repo.statusName;
  switch (status) {
    case "Completed":
      return {
        label: "已就绪",
        icon: CheckCircle2,
        className: "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10",
      };
    case "Processing":
      return {
        label: "构建中",
        icon: Loader2,
        className: "text-blue-600 dark:text-blue-400 bg-blue-500/10",
        spin: true,
      };
    case "Failed":
      return {
        label: "失败",
        icon: XCircle,
        className: "text-rose-600 dark:text-rose-400 bg-rose-500/10",
      };
    default:
      return {
        label: "排队中",
        icon: Clock,
        className: "text-amber-600 dark:text-amber-400 bg-amber-500/10",
      };
  }
}

export function RepositoryGroupView({
  repositories,
  emptyMessage = "暂无代码仓库",
  renderActions,
}: RepositoryGroupViewProps) {
  const [renamedMap, setRenamedMap] = useState<Record<string, string>>({});
  const [editingGroup, setEditingGroup] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  // 人员权限设置弹窗状态
  const [permDialogGroup, setPermDialogGroup] = useState<string | null>(null);
  const [permIsPublic, setPermIsPublic] = useState(true);
  const [permEmployeeNos, setPermEmployeeNos] = useState("");
  const [isSavingPerm, setIsSavingPerm] = useState(false);

  const groups = useMemo(() => {
    const map = new Map<string, RepositoryItemResponse[]>();
    for (const repo of repositories) {
      const rawOrg = repo.orgName || "默认系统组";
      const key = renamedMap[rawOrg] || rawOrg;
      const list = map.get(key) || [];
      list.push({ ...repo, orgName: key });
      map.set(key, list);
    }

    return Array.from(map.entries())
      .map(([groupName, items]) => {
        const completedCount = items.filter(
          (r) => r.statusName === "Completed"
        ).length;
        return {
          groupName,
          items,
          completedCount,
          isMultiRepo: items.length > 1,
        };
      })
      .sort((a, b) => b.items.length - a.items.length);
  }, [repositories, renamedMap]);

  const handleCopyGroupId = (groupName: string) => {
    navigator.clipboard.writeText(groupName);
    toast.success(`已复制系统组标识: ${groupName}（可用于 Agent 跨前后端联合问答）`);
  };

  const startEditing = (groupName: string) => {
    setEditingGroup(groupName);
    setDraftName(groupName);
  };

  const cancelEditing = () => {
    setEditingGroup(null);
    setDraftName("");
  };

  const saveGroupName = async (oldGroupName: string) => {
    const trimmed = draftName.trim();
    if (!trimmed) {
      toast.error("仓库组名称不能为空");
      return;
    }
    if (trimmed === oldGroupName) {
      cancelEditing();
      return;
    }

    setIsSaving(true);
    try {
      await api.put("/api/v1/repositories/groups/rename", {
        oldGroupName,
        newGroupName: trimmed,
      });
      setRenamedMap((prev) => {
        const next = { ...prev, [oldGroupName]: trimmed };
        for (const k of Object.keys(next)) {
          if (next[k] === oldGroupName) {
            next[k] = trimmed;
          }
        }
        return next;
      });
      toast.success(`已将仓库组「${oldGroupName}」重命名为「${trimmed}」（同名智能体应用已自动同步）`);
      cancelEditing();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "修改仓库组名称失败，请先登录");
    } finally {
      setIsSaving(false);
    }
  };

  const openPermDialog = (groupName: string, items: RepositoryItemResponse[]) => {
    setPermDialogGroup(groupName);
    setPermIsPublic(items.every((r) => r.isPublic));
    setPermEmployeeNos("");
  };

  const saveGroupPermissions = async () => {
    if (!permDialogGroup) return;
    setIsSavingPerm(true);
    try {
      const empList = permEmployeeNos
        .split(/[,;，；\s]+/)
        .map((s) => s.trim())
        .filter(Boolean);

      await api.put("/api/v1/repositories/groups/permissions", {
        groupName: permDialogGroup,
        isPublic: empList.length > 0 ? false : permIsPublic,
        employeeNos: empList,
      });
      toast.success(
        empList.length > 0
          ? `已为「${permDialogGroup}」设置 ${empList.length} 名授权员工工号（已自动同步至关联智能体应用）`
          : `已更新「${permDialogGroup}」访问权限为：${permIsPublic ? "全员可见" : "私有受限"}`
      );
      setPermDialogGroup(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "保存人员权限失败，请确认已登录");
    } finally {
      setIsSavingPerm(false);
    }
  };

  if (groups.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <GitBranch className="h-12 w-12 text-muted-foreground mb-4" />
        <p className="text-muted-foreground">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {groups.map((group) => (
          <div
            key={group.groupName}
            className="flex flex-col rounded-xl border border-border/80 bg-card/60 shadow-xs transition-all hover:border-border"
          >
            {/* Group Header */}
            <div className="flex items-center justify-between gap-3 border-b border-border/60 bg-muted/20 px-4 py-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Layers className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    {editingGroup === group.groupName ? (
                      <div className="flex items-center gap-1.5">
                        <input
                          type="text"
                          value={draftName}
                          onChange={(e) => setDraftName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") saveGroupName(group.groupName);
                            if (e.key === "Escape") cancelEditing();
                          }}
                          autoFocus
                          disabled={isSaving}
                          className="h-7 w-40 rounded-md border border-emerald-500/60 bg-background px-2 text-sm font-semibold text-foreground focus:outline-none focus:ring-1 focus:ring-emerald-500"
                        />
                        <button
                          type="button"
                          disabled={isSaving}
                          onClick={() => saveGroupName(group.groupName)}
                          className="inline-flex h-6 w-6 items-center justify-center rounded bg-emerald-600 text-white hover:bg-emerald-500"
                          title="保存新组名"
                        >
                          {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                        </button>
                        <button
                          type="button"
                          disabled={isSaving}
                          onClick={cancelEditing}
                          className="inline-flex h-6 w-6 items-center justify-center rounded bg-muted text-muted-foreground hover:text-foreground"
                          title="取消"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ) : (
                      <>
                        <h3 className="truncate font-semibold text-sm text-foreground">
                          {group.groupName}
                        </h3>
                        <button
                          type="button"
                          onClick={() => startEditing(group.groupName)}
                          title="修改系统仓库组名称"
                          className="inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
                      </>
                    )}
                    <span className="inline-flex shrink-0 items-center rounded-md bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                      {group.items.length} 个代码库
                    </span>
                    {group.isMultiRepo && (
                      <span className="hidden sm:inline-flex shrink-0 items-center rounded-md border border-teal-500/30 bg-teal-500/10 px-1.5 py-0.5 text-[10px] font-medium text-teal-600 dark:text-teal-400">
                        前后端/多库协同组
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    已就绪 {group.completedCount}/{group.items.length} · 支持按 group 跨库联合检索与 AI 问答
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => openPermDialog(group.groupName, group.items)}
                  title="编辑该系统组的人员访问权限与飞书工号白名单"
                  className="inline-flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400 transition-colors hover:bg-emerald-500/20"
                >
                  <Users className="h-3 w-3" />
                  <span>人员授权</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleCopyGroupId(group.groupName)}
                  title="复制业务系统组标识（供 Open API / Agent 传入 group 参数）"
                  className="inline-flex items-center gap-1 rounded-md border border-border/70 bg-background/80 px-2 py-1 text-[11px] font-mono text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <Copy className="h-3 w-3" />
                  <span>group: {group.groupName}</span>
                </button>
              </div>
            </div>

            {/* Sub-repositories list inside this Business System Group */}
            <div className="divide-y divide-border/50 p-2">
              {group.items.map((repo) => {
                const role = inferRepoRole(repo);
                const RoleIcon = role.icon;
                const status = getStatusDisplay(repo);
                const StatusIcon = status.icon;
                const href = buildRepoBasePath(repo.orgName, repo.repoName);

                return (
                  <div
                    key={repo.id}
                    className="group/item flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-muted/40"
                  >
                    <Link href={href} className="flex items-center gap-3 min-w-0 flex-1">
                      <span
                        className={cn(
                          "inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium",
                          role.tone
                        )}
                      >
                        <RoleIcon className="h-3 w-3" />
                        {role.label}
                      </span>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-medium text-sm text-foreground group-hover/item:text-primary transition-colors">
                            {repo.repoName}
                          </span>
                          {repo.primaryLanguage && (
                            <span className="inline-flex shrink-0 items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                              <Code2 className="h-2.5 w-2.5" />
                              {repo.primaryLanguage}
                            </span>
                          )}
                        </div>
                        {repo.gitUrl && (
                          <p className="truncate text-[11px] font-mono text-muted-foreground/80 mt-0.5">
                            {repo.gitUrl}
                          </p>
                        )}
                      </div>
                    </Link>

                    <div className="flex items-center gap-2 shrink-0">
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
                          status.className
                        )}
                      >
                        <StatusIcon
                          className={cn("h-3 w-3", status.spin && "animate-spin")}
                        />
                        {status.label}
                      </span>

                      {renderActions && renderActions(repo)}

                      <Link
                        href={href}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                        title="查看知识库文档"
                      >
                        <ArrowUpRight className="h-4 w-4" />
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* 仓库组人员访问授权弹窗 */}
      <Dialog open={!!permDialogGroup} onOpenChange={(open) => !open && setPermDialogGroup(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users className="h-5 w-5 text-emerald-500" />
              「{permDialogGroup}」人员访问权限设置
            </DialogTitle>
            <DialogDescription>
              控制哪些飞书员工可以在 Zt Wiki 及 ZtWork 工作台中查看并向「{permDialogGroup}」提问。保存后将自动同步至该组下所有前后端仓库及关联智能体应用。
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="flex items-center justify-between rounded-lg border p-3 bg-muted/20">
              <div className="space-y-0.5">
                <Label className="text-sm font-medium">全员可见</Label>
                <p className="text-xs text-muted-foreground">
                  开启后，所有通过飞书认证的内部员工均可访问
                </p>
              </div>
              <Switch checked={permIsPublic} onCheckedChange={setPermIsPublic} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="groupEmpNos" className="text-sm font-medium">
                指定授权飞书员工工号白名单（逗号或空格分隔）
              </Label>
              <Input
                id="groupEmpNos"
                value={permEmployeeNos}
                onChange={(e) => setPermEmployeeNos(e.target.value)}
                placeholder="例如：zt64003, 64308, 64309（留空则按上方全员可见控制）"
              />
              <p className="text-xs text-muted-foreground">
                填写工号后，仅白名单内的工号（自动兼容 <code>zt64003</code> 与 <code>64003</code>）及系统管理员可访问该项目。
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setPermDialogGroup(null)} disabled={isSavingPerm}>
              取消
            </Button>
            <Button
              onClick={saveGroupPermissions}
              disabled={isSavingPerm}
              className="bg-emerald-600 hover:bg-emerald-500 text-white"
            >
              {isSavingPerm && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              保存人员权限
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
