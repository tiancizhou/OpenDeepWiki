"use client";

import { useEffect, useState } from "react";
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
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import {
  createApp,
  updateApp,
  ChatAppDto,
  CreateChatAppDto,
  UpdateChatAppDto,
  AppAiModel,
  AppMcpOption,
  AppAiProvider,
  AppKnowledgeOption,
  getAppAiModels,
  getAppAiProviders,
  getAppKnowledgeOptions,
  getAppMcpOptions,
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
  const [description, setDescription] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [iconUrl, setIconUrl] = useState("");
  const [enableDomainValidation, setEnableDomainValidation] = useState(false);
  const [allowedDomains, setAllowedDomains] = useState("");
  const [aiProviders, setAiProviders] = useState<AppAiProvider[]>([]);
  const [aiModels, setAiModels] = useState<AppAiModel[]>([]);
  const [aiProviderId, setAiProviderId] = useState("");
  const [defaultModel, setDefaultModel] = useState("");
  const [rateLimitPerMinute, setRateLimitPerMinute] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [knowledgeOptions, setKnowledgeOptions] = useState<AppKnowledgeOption[]>([]);
  const [knowledgeRepository, setKnowledgeRepository] = useState("_none");
  const [knowledgeBranch, setKnowledgeBranch] = useState("");
  const [knowledgeLanguage, setKnowledgeLanguage] = useState("");
  const [mcpOptions, setMcpOptions] = useState<AppMcpOption[]>([]);
  const [enabledMcpIds, setEnabledMcpIds] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;

    if (app) {
      setName(app.name);
      setDescription(app.description || "");
      setSystemPrompt(app.systemPrompt || "");
      setIconUrl(app.iconUrl || "");
      setEnableDomainValidation(app.enableDomainValidation);
      setAllowedDomains(app.allowedDomains.join("\n"));
      setAiProviderId(app.aiProviderId || "");
      setDefaultModel(app.defaultModel || "");
      setRateLimitPerMinute(app.rateLimitPerMinute?.toString() || "");
      setIsActive(app.isActive);
      setKnowledgeRepository(
        app.knowledgeOwner && app.knowledgeRepo
          ? `${app.knowledgeOwner}/${app.knowledgeRepo}`
          : "_none"
      );
      setKnowledgeBranch(app.knowledgeBranch || "");
      setKnowledgeLanguage(app.knowledgeLanguage || "");
      setEnabledMcpIds(app.enabledMcpIds || []);
    } else {
      setName("");
      setDescription("");
      setSystemPrompt("");
      setIconUrl("");
      setEnableDomainValidation(false);
      setAllowedDomains("");
      setAiProviderId("");
      setDefaultModel("");
      setRateLimitPerMinute("");
      setIsActive(true);
      setKnowledgeRepository("_none");
      setKnowledgeBranch("");
      setKnowledgeLanguage("");
      setEnabledMcpIds([]);
    }

    setError(null);
  }, [open, app]);

  useEffect(() => {
    if (!open) return;
    let isMounted = true;

    getAppAiProviders()
      .then((providers) => {
        if (!isMounted) return;
        setAiProviders(providers);
        setAiProviderId((current) => current || app?.aiProviderId || providers[0]?.id || "");
      })
      .catch(() => setError(t("apps.form.loadAiProvidersFailed")));

    getAppKnowledgeOptions()
      .then((options) => {
        if (!isMounted) return;
        setKnowledgeOptions(options);
      })
      .catch(() => setError(t("apps.form.loadKnowledgeOptionsFailed")));

    getAppMcpOptions()
      .then((options) => {
        if (!isMounted) return;
        setMcpOptions(options);
      })
      .catch(() => setError(t("apps.form.loadMcpOptionsFailed")));

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
      .catch(() => setError(t("apps.form.loadAiModelsFailed")));

    return () => {
      isMounted = false;
    };
  }, [aiProviderId]);

  useEffect(() => {
    if (knowledgeRepository === "_none") {
      setKnowledgeBranch("");
      setKnowledgeLanguage("");
      return;
    }

    const options = knowledgeOptions.filter(
      (option) => `${option.owner}/${option.repo}` === knowledgeRepository
    );
    if (options.length === 0) {
      return;
    }

    setKnowledgeBranch((current) =>
      current && options.some((option) => option.branch === current)
        ? current
        : options[0].branch
    );
  }, [knowledgeOptions, knowledgeRepository]);

  useEffect(() => {
    if (knowledgeRepository === "_none" || !knowledgeBranch) {
      setKnowledgeLanguage("");
      return;
    }

    const options = knowledgeOptions.filter(
      (option) =>
        `${option.owner}/${option.repo}` === knowledgeRepository &&
        option.branch === knowledgeBranch
    );
    if (options.length === 0) {
      return;
    }

    setKnowledgeLanguage((current) =>
      current && options.some((option) => option.language === current)
        ? current
        : options.find((option) => option.isDefaultLanguage)?.language ||
          options[0].language
    );
  }, [knowledgeBranch, knowledgeOptions, knowledgeRepository]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim()) {
      setError(t("apps.form.nameRequired"));
      return;
    }

    if (!aiProviderId) {
      setError(t("apps.form.aiProviderRequired"));
      return;
    }

    if (!defaultModel.trim()) {
      setError(t("apps.form.defaultModelRequired"));
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const domainsArray = allowedDomains
        .split("\n")
        .map((domain) => domain.trim())
        .filter(Boolean);
      const modelsArray = defaultModel.trim() ? [defaultModel.trim()] : [];
      const selectedProvider = aiProviders.find((provider) => provider.id === aiProviderId);
      const selectedKnowledge = knowledgeOptions.find(
        (option) =>
          `${option.owner}/${option.repo}` === knowledgeRepository &&
          option.branch === knowledgeBranch &&
          option.language === knowledgeLanguage
      );
      const knowledgeBinding =
        knowledgeRepository !== "_none" && selectedKnowledge
          ? {
              knowledgeOwner: selectedKnowledge.owner,
              knowledgeRepo: selectedKnowledge.repo,
              knowledgeBranch: selectedKnowledge.branch,
              knowledgeLanguage: selectedKnowledge.language,
            }
          : {
              knowledgeOwner: "",
              knowledgeRepo: "",
              knowledgeBranch: "",
              knowledgeLanguage: "",
            };

      if (isEditing && app) {
        const updateDto: UpdateChatAppDto = {
          name: name.trim(),
          description: description.trim() || undefined,
          systemPrompt: systemPrompt.trim(),
          iconUrl: iconUrl.trim() || undefined,
          enableDomainValidation,
          allowedDomains: domainsArray,
          aiProviderId,
          providerType: selectedProvider?.providerType,
          availableModels: modelsArray,
          defaultModel: defaultModel.trim(),
          rateLimitPerMinute: rateLimitPerMinute
            ? parseInt(rateLimitPerMinute, 10)
            : undefined,
          isActive,
          enabledMcpIds,
          ...knowledgeBinding,
        };
        await updateApp(app.id, updateDto);
      } else {
        const createDto: CreateChatAppDto = {
          name: name.trim(),
          description: description.trim() || undefined,
          systemPrompt: systemPrompt.trim() || undefined,
          iconUrl: iconUrl.trim() || undefined,
          enableDomainValidation,
          allowedDomains: domainsArray,
          aiProviderId,
          providerType: selectedProvider?.providerType || "OpenAI",
          availableModels: modelsArray,
          defaultModel: defaultModel.trim(),
          rateLimitPerMinute: rateLimitPerMinute
            ? parseInt(rateLimitPerMinute, 10)
            : undefined,
          enabledMcpIds,
          ...knowledgeBinding,
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
  const currentKnowledgeRepository =
    app?.knowledgeOwner && app?.knowledgeRepo
      ? `${app.knowledgeOwner}/${app.knowledgeRepo}`
      : null;
  const repositoryOptions = Array.from(
    new Map(
      [
        ...knowledgeOptions.map((option) => [
          `${option.owner}/${option.repo}`,
          {
            value: `${option.owner}/${option.repo}`,
            label: option.displayName,
          },
        ] as const),
        ...(currentKnowledgeRepository
          ? [
              [
                currentKnowledgeRepository,
                {
                  value: currentKnowledgeRepository,
                  label: currentKnowledgeRepository,
                },
              ] as const,
            ]
          : []),
      ]
    ).values()
  );
  const branchOptions = Array.from(
    new Set(
      [
        ...knowledgeOptions
          .filter((option) => `${option.owner}/${option.repo}` === knowledgeRepository)
          .map((option) => option.branch),
        ...(currentKnowledgeRepository === knowledgeRepository && app?.knowledgeBranch
          ? [app.knowledgeBranch]
          : []),
      ]
    )
  );
  const languageOptions = Array.from(
    new Set([
      ...knowledgeOptions
        .filter(
          (option) =>
            `${option.owner}/${option.repo}` === knowledgeRepository &&
            option.branch === knowledgeBranch
        )
        .map((option) => option.language),
      ...(currentKnowledgeRepository === knowledgeRepository &&
      app?.knowledgeBranch === knowledgeBranch &&
      app?.knowledgeLanguage
        ? [app.knowledgeLanguage]
        : []),
    ])
  );
  const toggleMcp = (mcpId: string, checked: boolean) => {
    setEnabledMcpIds((current) =>
      checked
        ? Array.from(new Set([...current, mcpId]))
        : current.filter((id) => id !== mcpId)
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? t("apps.form.editTitle") : t("apps.form.createTitle")}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          {error && (
            <div className="bg-destructive/10 text-destructive px-4 py-2 rounded-md text-sm">
              {error}
            </div>
          )}

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">{t("apps.form.name")} *</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("apps.form.namePlaceholder")}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">{t("apps.form.description")}</Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t("apps.form.descriptionPlaceholder")}
                rows={2}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="systemPrompt">{t("apps.form.systemPrompt")}</Label>
              <Textarea
                id="systemPrompt"
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                placeholder={t("apps.form.systemPromptPlaceholder")}
                rows={5}
              />
              <p className="text-sm text-muted-foreground">
                {t("apps.form.systemPromptHint")}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="iconUrl">{t("apps.form.iconUrl")}</Label>
              <Input
                id="iconUrl"
                value={iconUrl}
                onChange={(e) => setIconUrl(e.target.value)}
                placeholder={t("apps.form.iconUrlPlaceholder")}
              />
            </div>
          </div>

          <div className="space-y-4 border-t pt-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>{t("apps.form.domainValidation")}</Label>
                <p className="text-sm text-muted-foreground">
                  {t("apps.form.domainValidationHint")}
                </p>
              </div>
              <Switch
                checked={enableDomainValidation}
                onCheckedChange={setEnableDomainValidation}
              />
            </div>

            {enableDomainValidation && (
              <div className="space-y-2">
                <Label htmlFor="allowedDomains">
                  {t("apps.form.allowedDomains")}
                </Label>
                <Textarea
                  id="allowedDomains"
                  value={allowedDomains}
                  onChange={(e) => setAllowedDomains(e.target.value)}
                  placeholder={t("apps.form.allowedDomainsPlaceholder")}
                  rows={3}
                />
              </div>
            )}
          </div>

          <div className="space-y-4 border-t pt-4">
            <h3 className="font-medium">{t("apps.form.aiConfig")}</h3>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{t("apps.form.aiProvider")} *</Label>
                <Select value={aiProviderId} onValueChange={setAiProviderId}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={t("apps.form.aiProviderPlaceholder")} />
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
                <Label>{t("apps.form.defaultModel")} *</Label>
                <Select
                  value={defaultModel}
                  onValueChange={setDefaultModel}
                  disabled={!aiProviderId || aiModels.length === 0}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue
                      placeholder={t("apps.form.defaultModelPlaceholder")}
                    />
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

            <p className="text-sm text-muted-foreground">
              {t("apps.form.aiProviderHint")}
            </p>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="rateLimit">
                  {t("apps.form.rateLimitPerMinute")}
                </Label>
                <Input
                  id="rateLimit"
                  type="number"
                  min="0"
                  value={rateLimitPerMinute}
                  onChange={(e) => setRateLimitPerMinute(e.target.value)}
                  placeholder={t("apps.form.rateLimitPlaceholder")}
                />
              </div>
            </div>
          </div>

          <div className="space-y-4 border-t pt-4">
            <div className="space-y-1">
              <h3 className="font-medium">{t("apps.form.knowledgeBase")}</h3>
              <p className="text-sm text-muted-foreground">
                {t("apps.form.knowledgeBaseHint")}
              </p>
            </div>

            <div className="space-y-2">
              <Label>{t("apps.form.repository")}</Label>
              <Select
                value={knowledgeRepository}
                onValueChange={setKnowledgeRepository}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t("apps.form.repositoryPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">{t("apps.form.noKnowledgeBase")}</SelectItem>
                  {repositoryOptions.map((repository) => (
                    <SelectItem key={repository.value} value={repository.value}>
                      {repository.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {knowledgeRepository !== "_none" && (
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>{t("apps.form.branch")}</Label>
                  <Select
                    value={knowledgeBranch}
                    onValueChange={setKnowledgeBranch}
                    disabled={branchOptions.length === 0}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder={t("apps.form.branchPlaceholder")} />
                    </SelectTrigger>
                    <SelectContent>
                      {branchOptions.map((branch) => (
                        <SelectItem key={branch} value={branch}>
                          {branch}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>{t("apps.form.language")}</Label>
                  <Select
                    value={knowledgeLanguage}
                    onValueChange={setKnowledgeLanguage}
                    disabled={languageOptions.length === 0}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder={t("apps.form.languagePlaceholder")} />
                    </SelectTrigger>
                    <SelectContent>
                      {languageOptions.map((language) => (
                        <SelectItem key={language} value={language}>
                          {language}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
          </div>

          <div className="space-y-4 border-t pt-4">
            <div className="space-y-1">
              <h3 className="font-medium">{t("apps.form.mcpTools")}</h3>
              <p className="text-sm text-muted-foreground">
                {t("apps.form.mcpToolsHint")}
              </p>
            </div>

            {mcpOptions.length === 0 ? (
              <p className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
                {t("apps.form.noMcpTools")}
              </p>
            ) : (
              <div className="space-y-2">
                {mcpOptions.map((mcp) => (
                  <label
                    key={mcp.id}
                    className="flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors hover:bg-muted/50"
                  >
                    <Checkbox
                      checked={enabledMcpIds.includes(mcp.id)}
                      onCheckedChange={(checked) => toggleMcp(mcp.id, checked === true)}
                      className="mt-0.5"
                    />
                    <span className="min-w-0 flex-1 space-y-1">
                      <span className="block text-sm font-medium leading-none">
                        {mcp.name}
                      </span>
                      {mcp.description && (
                        <span className="block text-sm text-muted-foreground">
                          {mcp.description}
                        </span>
                      )}
                    </span>
                  </label>
                ))}
              </div>
            )}
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
