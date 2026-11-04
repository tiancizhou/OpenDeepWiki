"use client";

import { useEffect, useState, useMemo } from "react";
import { useTranslations } from "@/hooks/use-translations";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Layers, CheckSquare, Square, Users, ShieldCheck } from "lucide-react";
import {
  createApp,
  updateApp,
  ChatAppDto,
  ChatAppBoundRepoDto,
  CreateChatAppDto,
  UpdateChatAppDto,
  AppAiModel,
  AppAiProvider,
  getAppAiModels,
  getAppAiProviders,
  getAvailableRepositories,
} from "@/lib/apps-api";

interface AppFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  app?: ChatAppDto | null;
  onSuccess: () => void;
}

export function AppFormDialog({
  open,
  onOpenChange,
  app,
  onSuccess,
}: AppFormDialogProps) {
  const t = useTranslations();
  const isEditing = !!app;

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [groupName, setGroupName] = useState("业务系统智能体");
  const [description, setDescription] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [iconUrl, setIconUrl] = useState("");
  const [selectedRepoIds, setSelectedRepoIds] = useState<string[]>([]);
  const [availableRepos, setAvailableRepos] = useState<ChatAppBoundRepoDto[]>([]);
  const [isPublic, setIsPublic] = useState(true);
  const [allowedEmployeeNos, setAllowedEmployeeNos] = useState("");
  const [enableDomainValidation, setEnableDomainValidation] = useState(false);
  const [allowedDomains, setAllowedDomains] = useState("");
  const [aiProviders, setAiProviders] = useState<AppAiProvider[]>([]);
  const [aiModels, setAiModels] = useState<AppAiModel[]>([]);
  const [aiProviderId, setAiProviderId] = useState("");
  const [defaultModel, setDefaultModel] = useState("");
  const [rateLimitPerMinute, setRateLimitPerMinute] = useState("");
  const [isActive, setIsActive] = useState(true);

  useEffect(() => {
    if (!open) return;

    if (app) {
      setName(app.name);
      setGroupName(app.groupName || "业务系统智能体");
      setDescription(app.description || "");
      setSystemPrompt(app.systemPrompt || "");
      setIconUrl(app.iconUrl || "");
      setSelectedRepoIds(app.repositoryIds || []);
      setIsPublic(app.isPublic ?? true);
      setAllowedEmployeeNos(app.allowedEmployeeNos || "");
      setEnableDomainValidation(app.enableDomainValidation);
      setAllowedDomains(app.allowedDomains.join("\n"));
      setAiProviderId(app.aiProviderId || "");
      setDefaultModel(app.defaultModel || "");
      setRateLimitPerMinute(app.rateLimitPerMinute?.toString() || "");
      setIsActive(app.isActive);
    } else {
      setName("");
      setGroupName("业务系统智能体");
      setDescription("");
      setSystemPrompt("");
      setIconUrl("");
      setSelectedRepoIds([]);
      setIsPublic(true);
      setAllowedEmployeeNos("");
      setEnableDomainValidation(false);
      setAllowedDomains("");
      setAiProviderId("");
      setDefaultModel("");
      setRateLimitPerMinute("");
      setIsActive(true);
    }

    setError(null);
  }, [open, app]);

  useEffect(() => {
    if (!open) return;
    let isMounted = true;

    getAvailableRepositories()
      .then((repos) => {
        if (!isMounted) return;
        setAvailableRepos(repos);
      })
      .catch(() => {
        // Ignore repo loading error
      });

    getAppAiProviders()
      .then((providers) => {
        if (!isMounted) return;
        setAiProviders(providers);
        setAiProviderId((current) => current || app?.aiProviderId || providers[0]?.id || "");
      })
      .catch(() => {
        // Optional AI provider
      });

    return () => {
      isMounted = false;
    };
  }, [open, app?.aiProviderId]);

  useEffect(() => {
    if (!aiProviderId) {
      setAiModels([]);
      setDefaultModel("");
      return;
    }

    let isMounted = true;

    getAppAiModels(aiProviderId)
      .then((models) => {
        if (!isMounted) return;
        setAiModels(models);
        setDefaultModel((current) =>
          current && models.some((model) => model.modelId === current)
            ? current
            : models.find((model) => model.isDefault)?.modelId || models[0]?.modelId || ""
        );
      })
      .catch(() => {
        // Optional AI models
      });

    return () => {
      isMounted = false;
    };
  }, [aiProviderId]);

  const groupedRepos = useMemo(() => {
    const map = new Map<string, ChatAppBoundRepoDto[]>();
    for (const r of availableRepos) {
      const key = r.orgName || "默认";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    }
    return Array.from(map.entries());
  }, [availableRepos]);

  const toggleRepo = (id: string) => {
    setSelectedRepoIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const toggleOrgGroup = (orgName: string, repos: ChatAppBoundRepoDto[]) => {
    const ids = repos.map((r) => r.id);
    const allSelected = ids.every((id) => selectedRepoIds.includes(id));
    if (allSelected) {
      setSelectedRepoIds((prev) => prev.filter((id) => !ids.includes(id)));
    } else {
      setSelectedRepoIds((prev) => Array.from(new Set([...prev, ...ids])));
      if (!name.trim()) {
        setName(orgName);
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim()) {
      setError("请输入智能体应用名称（例如：南通机物料）");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const domainsArray = allowedDomains
        .split("\n")
        .map((domain) => domain.trim())
        .filter(Boolean);
      const modelsArray = aiModels.map((model) => model.modelId);
      const selectedProvider = aiProviders.find((provider) => provider.id === aiProviderId);

      if (isEditing && app) {
        const updateDto: UpdateChatAppDto = {
          name: name.trim(),
          groupName: groupName.trim() || "业务系统智能体",
          description: description.trim() || undefined,
          systemPrompt: systemPrompt.trim() || "",
          iconUrl: iconUrl.trim() || undefined,
          repositoryIds: selectedRepoIds,
          isPublic,
          allowedEmployeeNos: allowedEmployeeNos.trim(),
          enableDomainValidation,
          allowedDomains: domainsArray,
          aiProviderId: aiProviderId || undefined,
          providerType: selectedProvider?.providerType || "OpenAI",
          availableModels: modelsArray,
          defaultModel: defaultModel.trim() || undefined,
          rateLimitPerMinute: rateLimitPerMinute
            ? parseInt(rateLimitPerMinute, 10)
            : undefined,
          isActive,
        };
        await updateApp(app.id, updateDto);
      } else {
        const createDto: CreateChatAppDto = {
          name: name.trim(),
          groupName: groupName.trim() || "业务系统智能体",
          description: description.trim() || undefined,
          systemPrompt: systemPrompt.trim() || undefined,
          iconUrl: iconUrl.trim() || undefined,
          repositoryIds: selectedRepoIds,
          isPublic,
          allowedEmployeeNos: allowedEmployeeNos.trim() || undefined,
          enableDomainValidation,
          allowedDomains: domainsArray,
          aiProviderId: aiProviderId || undefined,
          providerType: selectedProvider?.providerType || "OpenAI",
          availableModels: modelsArray,
          defaultModel: defaultModel.trim() || undefined,
          rateLimitPerMinute: rateLimitPerMinute
            ? parseInt(rateLimitPerMinute, 10)
            : undefined,
        };
        await createApp(createDto);
      }

      onSuccess();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : isEditing
            ? t("apps.form.updateFailed")
            : t("apps.form.createFailed")
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const modelOptions = aiModels.map((model) => model.modelId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? "编辑智能体应用（ZtWork & MCP 统一对外单元）" : "创建智能体应用（封装多代码仓库知识库）"}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          {error && (
            <div className="bg-destructive/10 text-destructive px-4 py-2 rounded-md text-sm">
              {error}
            </div>
          )}

          {/* 基本信息 */}
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="name">智能体应用名称（对外显示名） *</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="例如：南通机物料、招投标、mqg"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="groupName">业务分组（ZtWork 折叠分组名）</Label>
                <Input
                  id="groupName"
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                  placeholder="例如：采购供应、制造执行、业务系统智能体"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">业务范围描述（供 ZtWork 展示与相关性判断）</Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="一两句话说明该智能体覆盖的业务范围，例如：南通基地机物料采购、到货、入库相关系统的设计与接口文档"
                rows={2}
              />
            </div>
          </div>

          {/* 绑定代码仓库（支持跨前后端多仓库勾选） */}
          <div className="space-y-3 border-t pt-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Layers className="h-4 w-4 text-emerald-500" />
                <Label className="text-base font-medium">
                  挂载知识库代码仓库（已选 {selectedRepoIds.length} 个）
                </Label>
              </div>
              <span className="text-xs text-muted-foreground">
                外部客户端仅与本智能体交互，不会感知底层具体仓库
              </span>
            </div>

            {groupedRepos.length === 0 ? (
              <div className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
                暂无已导入的代码仓库，请先在首页接入代码仓库
              </div>
            ) : (
              <div className="space-y-3 max-h-56 overflow-y-auto rounded-lg border p-3 bg-muted/20">
                {groupedRepos.map(([orgName, repos]) => {
                  const allChecked = repos.every((r) => selectedRepoIds.includes(r.id));
                  return (
                    <div key={orgName} className="space-y-1.5">
                      <div className="flex items-center justify-between bg-muted/50 px-2.5 py-1.5 rounded-md">
                        <span className="text-xs font-semibold text-foreground">
                          业务系统 / 命名空间：{orgName}（{repos.length} 个仓库）
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-6 px-2 text-xs text-emerald-600 dark:text-emerald-400"
                          onClick={() => toggleOrgGroup(orgName, repos)}
                        >
                          {allChecked ? "取消全选本组" : "一键全选本组"}
                        </Button>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 pl-1">
                        {repos.map((repo) => {
                          const checked = selectedRepoIds.includes(repo.id);
                          return (
                            <div
                              key={repo.id}
                              onClick={() => toggleRepo(repo.id)}
                              className={`flex items-center justify-between rounded-md border px-3 py-2 cursor-pointer transition-colors ${
                                checked
                                  ? "border-emerald-500/60 bg-emerald-500/10"
                                  : "border-border hover:bg-muted/40"
                              }`}
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                {checked ? (
                                  <CheckSquare className="h-4 w-4 text-emerald-500 shrink-0" />
                                ) : (
                                  <Square className="h-4 w-4 text-muted-foreground shrink-0" />
                                )}
                                <div className="truncate">
                                  <div className="text-xs font-medium truncate">
                                    {repo.orgName} / <span className="font-semibold">{repo.repoName}</span>
                                  </div>
                                </div>
                              </div>
                              <span
                                className={`text-[10px] px-1.5 py-0.5 rounded ${
                                  repo.statusName === "Completed"
                                    ? "bg-emerald-500/15 text-emerald-500"
                                    : "bg-amber-500/15 text-amber-500"
                                }`}
                              >
                                {repo.statusName === "Completed" ? "已就绪" : "构建中"}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 飞书工号与访问权限控制 */}
          <div className="space-y-4 border-t pt-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-emerald-500" />
                  <Label>全员可见（公司内部飞书员工均可访问）</Label>
                </div>
                <p className="text-xs text-muted-foreground">
                  关闭后，仅下方授权白名单内的飞书工号及管理员可在 ZtWork 中看到并提问
                </p>
              </div>
              <Switch checked={isPublic} onCheckedChange={setIsPublic} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="allowedEmployeeNos" className="flex items-center gap-1.5">
                <Users className="h-3.5 w-3.5 text-muted-foreground" />
                指定飞书员工工号白名单（可选，逗号分隔，填写后仅白名单工号可访问）
              </Label>
              <Input
                id="allowedEmployeeNos"
                value={allowedEmployeeNos}
                onChange={(e) => setAllowedEmployeeNos(e.target.value)}
                placeholder="例如：zt64003, 64308, 64309（留空则按上方全员可见开关控制）"
              />
            </div>
          </div>

          {/* 专属系统提示词与 AI 模型配置 */}
          <div className="space-y-4 border-t pt-4">
            <h3 className="font-medium">智能体模型与专属提示词</h3>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>AI 模型提供商（可选，默认使用系统全局模型）</Label>
                <Select value={aiProviderId} onValueChange={setAiProviderId}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="使用系统默认提供商" />
                  </SelectTrigger>
                  <SelectContent>
                    {aiProviders.map((provider) => (
                      <SelectItem key={provider.id} value={provider.id}>
                        {provider.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>{t("apps.form.defaultModel")}</Label>
                <Select
                  value={defaultModel}
                  onValueChange={setDefaultModel}
                  disabled={!aiProviderId || aiModels.length === 0}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="默认模型" />
                  </SelectTrigger>
                  <SelectContent>
                    {modelOptions.map((model) => (
                      <SelectItem key={model} value={model}>
                        {model}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="systemPrompt">智能体专属系统提示词（System Prompt，可选）</Label>
              <Textarea
                id="systemPrompt"
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                placeholder="例如：你是南通机物料系统的架构师助手，回答接口方案时请同时给出前端 Saber 路由调用方式与后端 Biz 控制器定义……"
                rows={3}
              />
            </div>
          </div>

          {isEditing && (
            <div className="flex items-center justify-between border-t pt-4">
              <Label>{t("apps.form.isActive")}</Label>
              <Switch checked={isActive} onCheckedChange={setIsActive} />
            </div>
          )}

          <div className="flex justify-end gap-2 border-t pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {t("common.save")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
