"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useTranslations } from "@/hooks/use-translations";
import {
  submitRepository,
  submitArchiveRepository,
  submitLocalDirectoryRepository,
  fetchGitBranches,
  checkGitHubRepo,
} from "@/lib/repository-api";
import type {
  RepositorySubmitRequest,
  ArchiveRepositorySubmitRequest,
  LocalDirectoryRepositorySubmitRequest,
  GitBranchItem,
  RepositorySourceType,
} from "@/types/repository";
import {
  Loader2,
  GitBranch,
  Globe,
  Lock,
  Link2,
  FolderGit2,
  Search,
  Edit3,
  Archive,
  FolderOpen,
  Layers,
  Plus,
  Trash2,
  ChevronDown,
  ChevronUp,
  Settings2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { ApiError } from "@/lib/api-client";
import { defaultWikiLanguage, wikiLanguageCodes } from "@/i18n/config";

interface RepositorySubmitFormProps {
  onSuccess?: () => void;
}

interface SubRepoRow {
  id: string;
  role: string;
  gitUrl: string;
  repoName: string;
  branchName: string;
}

const ROLE_OPTIONS = ["前端", "后端", "全栈", "微服务", "移动端", "公共库"];

const GIT_URL_REGEX = /^(https?:\/\/|git@)[\w.-]+[/:].+?(\.git)?$/i;

const SUPPORTED_LANGUAGES = wikiLanguageCodes;

const SOURCE_OPTIONS: Array<{
  value: RepositorySourceType;
  icon: typeof Link2;
  labelKey: string;
  descriptionKey: string;
}> = [
  {
    value: "Git",
    icon: Link2,
    labelKey: "sourceTypeGit",
    descriptionKey: "sourceTypeGitDescription",
  },
  {
    value: "Archive",
    icon: Archive,
    labelKey: "sourceTypeArchive",
    descriptionKey: "sourceTypeArchiveDescription",
  },
  {
    value: "LocalDirectory",
    icon: FolderOpen,
    labelKey: "sourceTypeLocal",
    descriptionKey: "sourceTypeLocalDescription",
  },
];

function parseGitUrl(url: string): { orgName: string; repoName: string } | null {
  const httpsMatch = url.match(/https?:\/\/[^/]+\/(.+?)\/([^/]+?)(?:\.git)?$/i);
  if (httpsMatch) {
    return { orgName: httpsMatch[1], repoName: httpsMatch[2] };
  }

  const sshMatch = url.match(/git@[^:]+:(.+?)\/([^/]+?)(?:\.git)?$/i);
  if (sshMatch) {
    return { orgName: sshMatch[1], repoName: sshMatch[2] };
  }

  return null;
}

function createInitialSubRepos(): SubRepoRow[] {
  return [
    {
      id: "sub-fe",
      role: "前端",
      gitUrl: "",
      repoName: "",
      branchName: "main",
    },
    {
      id: "sub-be",
      role: "后端",
      gitUrl: "",
      repoName: "",
      branchName: "main",
    },
  ];
}

export function RepositorySubmitForm({ onSuccess }: RepositorySubmitFormProps) {
  const t = useTranslations();

  const [sourceType, setSourceType] = useState<RepositorySourceType>("Git");
  const [gitSubmitMode, setGitSubmitMode] = useState<"single" | "group">("group");
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Single repo state
  const [gitUrl, setGitUrl] = useState("");
  const [orgName, setOrgName] = useState("");
  const [repoName, setRepoName] = useState("");
  const [localPath, setLocalPath] = useState("");
  const [archiveFile, setArchiveFile] = useState<File | null>(null);
  const [branchName, setBranchName] = useState("main");

  // Multi-repo group state (for frontend + backend split systems)
  const [groupName, setGroupName] = useState("");
  const [subRepos, setSubRepos] = useState<SubRepoRow[]>(createInitialSubRepos);

  // Shared options & credentials
  const [languageCode, setLanguageCode] = useState<string>(defaultWikiLanguage);
  const [isPublic, setIsPublic] = useState(true);
  const [generateSkill, setGenerateSkill] = useState(true);
  const [authAccount, setAuthAccount] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [fileInputKey, setFileInputKey] = useState(0);

  const [branches, setBranches] = useState<GitBranchItem[]>([]);
  const [isLoadingBranches, setIsLoadingBranches] = useState(false);
  const [isSupported, setIsSupported] = useState(true);
  const [isManualInput, setIsManualInput] = useState(false);
  const [branchSearch, setBranchSearch] = useState("");
  const lastFetchedUrl = useRef<string>("");

  const resetGitBranchState = useCallback(() => {
    setBranches([]);
    setIsSupported(true);
    setIsManualInput(false);
    setBranchSearch("");
    lastFetchedUrl.current = "";
  }, []);

  const resetForm = useCallback(() => {
    setSourceType("Git");
    setGitUrl("");
    setOrgName("");
    setRepoName("");
    setGroupName("");
    setSubRepos(createInitialSubRepos());
    setLocalPath("");
    setArchiveFile(null);
    setBranchName("main");
    setLanguageCode(defaultWikiLanguage);
    setIsPublic(true);
    setGenerateSkill(true);
    setAuthAccount("");
    setAuthPassword("");
    setErrors({});
    setFileInputKey((current) => current + 1);
    resetGitBranchState();
  }, [resetGitBranchState]);

  const fetchBranchesDebounced = useCallback(async (url: string) => {
    if (!url.trim() || !GIT_URL_REGEX.test(url.trim())) {
      resetGitBranchState();
      return;
    }

    if (lastFetchedUrl.current === url.trim()) {
      return;
    }
    lastFetchedUrl.current = url.trim();

    setIsLoadingBranches(true);
    try {
      const result = await fetchGitBranches(url.trim());
      setBranches(result.branches);
      setIsSupported(result.isSupported);

      if (result.defaultBranch) {
        setBranchName(result.defaultBranch);
      } else if (result.branches.length > 0) {
        const defaultBranch = result.branches.find((branch) => branch.isDefault);
        if (defaultBranch) {
          setBranchName(defaultBranch.name);
        }
      }

      if (!result.isSupported) {
        setIsManualInput(true);
      }

      const parsed = parseGitUrl(url.trim());
      if (parsed && url.toLowerCase().includes("github.com")) {
        try {
          const repoCheck = await checkGitHubRepo(parsed.orgName, parsed.repoName);
          if (repoCheck.exists && repoCheck.isPrivate) {
            setIsPublic(false);
          }
        } catch (checkError) {
          console.error("Failed to check repo visibility:", checkError);
        }
      }
    } catch (error) {
      console.error("Failed to fetch branches:", error);
      setIsSupported(false);
      setIsManualInput(true);
    } finally {
      setIsLoadingBranches(false);
    }
  }, [resetGitBranchState]);

  useEffect(() => {
    if (sourceType !== "Git" || gitSubmitMode !== "single") {
      resetGitBranchState();
      return;
    }

    const timer = setTimeout(() => {
      if (gitUrl.trim() && GIT_URL_REGEX.test(gitUrl.trim())) {
        fetchBranchesDebounced(gitUrl);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [sourceType, gitSubmitMode, gitUrl, fetchBranchesDebounced, resetGitBranchState]);

  useEffect(() => {
    if (sourceType !== "Git" || gitSubmitMode !== "single") {
      return;
    }

    const parsed = parseGitUrl(gitUrl.trim());
    if (!parsed) {
      return;
    }

    setOrgName((current) => current.trim() || parsed.orgName);
    setRepoName((current) => current.trim() || parsed.repoName);
  }, [gitUrl, sourceType, gitSubmitMode]);

  const handleUpdateSubRepo = (id: string, patch: Partial<SubRepoRow>) => {
    setSubRepos((prev) =>
      prev.map((row) => {
        if (row.id !== id) return row;
        const updated = { ...row, ...patch };
        if (patch.gitUrl !== undefined) {
          const parsed = parseGitUrl(patch.gitUrl.trim());
          if (parsed) {
            if (!updated.repoName.trim()) {
              updated.repoName = parsed.repoName;
            }
            setGroupName((curr) => curr.trim() || parsed.orgName);
          }
        }
        return updated;
      })
    );
  };

  const handleAddSubRepo = () => {
    setSubRepos((prev) => [
      ...prev,
      {
        id: `sub-${Date.now()}-${prev.length}`,
        role: "微服务",
        gitUrl: "",
        repoName: "",
        branchName: "main",
      },
    ]);
  };

  const handleRemoveSubRepo = (id: string) => {
    setSubRepos((prev) => (prev.length > 1 ? prev.filter((r) => r.id !== id) : prev));
  };

  const filteredBranches = branches.filter((branch) =>
    branch.name.toLowerCase().includes(branchSearch.toLowerCase())
  );

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (sourceType === "Git" && gitSubmitMode === "group") {
      const activeRows = subRepos.filter((r) => r.gitUrl.trim().length > 0);
      if (activeRows.length === 0) {
        newErrors.groupRepos = "请至少填写一个子仓库的 Git 地址";
      } else {
        for (const row of activeRows) {
          if (!GIT_URL_REGEX.test(row.gitUrl.trim())) {
            newErrors.groupRepos = `Git 地址格式不正确: ${row.gitUrl}`;
            break;
          }
        }
      }

      const firstParsed = activeRows.length > 0 ? parseGitUrl(activeRows[0].gitUrl.trim()) : null;
      const effectiveGroup = groupName.trim() || firstParsed?.orgName || "";
      if (!effectiveGroup) {
        newErrors.groupName = "请填写业务系统 / 仓库组名称";
      }

      setErrors(newErrors);
      return Object.keys(newErrors).length === 0;
    }

    const parsedGitUrl = sourceType === "Git" ? parseGitUrl(gitUrl.trim()) : null;
    const effectiveOrgName = orgName.trim() || parsedGitUrl?.orgName || "";
    const effectiveRepoName = repoName.trim() || parsedGitUrl?.repoName || "";

    if (sourceType === "Git") {
      if (!gitUrl.trim()) {
        newErrors.gitUrl = t("home.repository.gitUrlRequired");
      } else if (!GIT_URL_REGEX.test(gitUrl.trim())) {
        newErrors.gitUrl = t("home.repository.gitUrlInvalid");
      }
    }

    if (!effectiveOrgName) {
      newErrors.orgName = t("home.repository.orgNameRequired");
    }

    if (!effectiveRepoName) {
      newErrors.repoName = t("home.repository.repoNameRequired");
    }

    if (sourceType === "Archive") {
      if (!archiveFile) {
        newErrors.archive = t("home.repository.archiveFileRequired");
      } else if (!archiveFile.name.toLowerCase().endsWith(".zip")) {
        newErrors.archive = t("home.repository.archiveFileInvalid");
      }
    }

    if (sourceType === "LocalDirectory" && !localPath.trim()) {
      newErrors.localPath = t("home.repository.localPathRequired");
    }

    if (!branchName.trim()) {
      newErrors.branchName = t("home.repository.branchNameRequired");
    }

    if (!languageCode) {
      newErrors.languageCode = t("home.repository.languageRequired");
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!validateForm()) {
      return;
    }

    setIsSubmitting(true);

    try {
      if (sourceType === "Git" && gitSubmitMode === "group") {
        const activeRows = subRepos.filter((r) => r.gitUrl.trim().length > 0);
        const firstParsed = parseGitUrl(activeRows[0].gitUrl.trim());
        const effectiveGroup = groupName.trim() || firstParsed?.orgName || "default-system";

        let submittedCount = 0;
        for (const row of activeRows) {
          const parsed = parseGitUrl(row.gitUrl.trim());
          const rawName = row.repoName.trim() || parsed?.repoName || "repo";
          const request: RepositorySubmitRequest = {
            gitUrl: row.gitUrl.trim(),
            orgName: effectiveGroup,
            repoName: rawName,
            branchName: row.branchName.trim() || "main",
            languageCode,
            isPublic,
            generateSkill,
            authAccount: authAccount.trim() || undefined,
            authPassword: authPassword || undefined,
          };
          await submitRepository(request);
          submittedCount++;
        }

        toast.success(`已成功将 ${submittedCount} 个代码仓库接入「${effectiveGroup}」系统仓库组！`);
        resetForm();
        onSuccess?.();
        return;
      }

      const parsedGitUrl = sourceType === "Git" ? parseGitUrl(gitUrl.trim()) : null;
      const effectiveOrgName = orgName.trim() || parsedGitUrl?.orgName || "";
      const effectiveRepoName = repoName.trim() || parsedGitUrl?.repoName || "";

      if (sourceType === "Git") {
        const request: RepositorySubmitRequest = {
          gitUrl: gitUrl.trim(),
          repoName: effectiveRepoName,
          orgName: effectiveOrgName,
          branchName: branchName.trim(),
          languageCode,
          isPublic,
          generateSkill,
          authAccount: authAccount.trim() || undefined,
          authPassword: authPassword || undefined,
        };

        await submitRepository(request);
      } else if (sourceType === "Archive" && archiveFile) {
        const request: ArchiveRepositorySubmitRequest = {
          repoName: effectiveRepoName,
          orgName: effectiveOrgName,
          branchName: branchName.trim(),
          languageCode,
          isPublic,
          generateSkill,
          archive: archiveFile,
        };

        await submitArchiveRepository(request);
      } else {
        const request: LocalDirectoryRepositorySubmitRequest = {
          repoName: effectiveRepoName,
          orgName: effectiveOrgName,
          localPath: localPath.trim(),
          branchName: branchName.trim(),
          languageCode,
          isPublic,
          generateSkill,
        };

        await submitLocalDirectoryRepository(request);
      }

      toast.success(t("home.repository.submitSuccess"));
      resetForm();
      onSuccess?.();
    } catch (error) {
      const message =
        error instanceof ApiError || error instanceof Error
          ? error.message
          : t("home.repository.submitError");
      toast.error(message || t("home.repository.submitError"));
      console.error("Failed to submit repository:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="flex items-center gap-3 pb-1">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-teal-500 to-emerald-500 text-white shadow-lg shadow-teal-500/25">
          <FolderGit2 className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-lg font-semibold">{t("home.repository.submitTitle")}</h2>
          <p className="text-xs text-muted-foreground">
            支持按「业务系统仓库组」一次性接入前后端分离的多个代码仓库，或接入单个仓库
          </p>
        </div>
      </div>

      {/* Source Type Selector */}
      <div className="grid gap-2 sm:grid-cols-3">
        {SOURCE_OPTIONS.map((option) => {
          const Icon = option.icon;
          const isActive = sourceType === option.value;

          return (
            <button
              key={option.value}
              type="button"
              className={cn(
                "rounded-xl border px-3.5 py-2.5 text-left transition-all",
                isActive
                  ? "border-teal-500 bg-teal-500/10 shadow-xs"
                  : "border-border bg-secondary/40 hover:bg-secondary/70"
              )}
              onClick={() => setSourceType(option.value)}
            >
              <div className="flex items-center gap-2 text-xs font-semibold">
                <Icon className="h-3.5 w-3.5 text-teal-600 dark:text-teal-400" />
                {t(`home.repository.${option.labelKey}`)}
              </div>
            </button>
          );
        })}
      </div>

      {/* Git Mode Switcher: Business System Group (Frontend + Backend) vs Single Repo */}
      {sourceType === "Git" && (
        <div className="flex items-center gap-1 rounded-xl border border-border/80 bg-muted/30 p-1">
          <button
            type="button"
            onClick={() => setGitSubmitMode("group")}
            className={cn(
              "flex-1 flex items-center justify-center gap-2 rounded-lg py-2 px-3 text-xs font-medium transition-all",
              gitSubmitMode === "group"
                ? "bg-background text-foreground shadow-xs border border-border/60"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Layers className="h-3.5 w-3.5 text-teal-500" />
            <span>业务系统仓库组（前后端分离 / 多库联合）</span>
          </button>
          <button
            type="button"
            onClick={() => setGitSubmitMode("single")}
            className={cn(
              "flex-1 flex items-center justify-center gap-2 rounded-lg py-2 px-3 text-xs font-medium transition-all",
              gitSubmitMode === "single"
                ? "bg-background text-foreground shadow-xs border border-border/60"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <FolderGit2 className="h-3.5 w-3.5 text-sky-500" />
            <span>单仓库接入</span>
          </button>
        </div>
      )}

      {/* GIT GROUP MODE: Multi-repo (Frontend + Backend) under one Business System */}
      {sourceType === "Git" && gitSubmitMode === "group" && (
        <div className="space-y-4 rounded-xl border border-border/80 bg-secondary/20 p-4">
          <div className="space-y-1.5">
            <label className="flex items-center justify-between text-xs font-semibold">
              <span className="flex items-center gap-1.5">
                <Layers className="h-3.5 w-3.5 text-teal-500" />
                所属业务系统 / 仓库组名称
              </span>
              <span className="text-[11px] font-normal text-muted-foreground">
                粘贴下方地址后可自动提取，也支持填写系统名（如 oa-approval 或内贸系统）
              </span>
            </label>
            <Input
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder="例如：nmps、oa-approval 或 OA审批系统"
              className="h-10 bg-background/80 text-sm"
            />
            {errors.groupName && <p className="text-xs text-destructive">{errors.groupName}</p>}
          </div>

          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-foreground">
                系统内子仓库列表（前端 / 后端 / 微服务）
              </label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleAddSubRepo}
                className="h-7 gap-1 text-xs px-2.5"
              >
                <Plus className="h-3 w-3" />
                添加同系统仓库
              </Button>
            </div>

            <div className="space-y-2.5">
              {subRepos.map((row, idx) => (
                <div
                  key={row.id}
                  className="rounded-lg border border-border/70 bg-background/70 p-3 space-y-2"
                >
                  <div className="flex items-center gap-2">
                    <select
                      value={row.role}
                      onChange={(e) => handleUpdateSubRepo(row.id, { role: e.target.value })}
                      className="h-9 rounded-md border border-border bg-secondary/60 px-2.5 text-xs font-medium text-foreground focus:outline-none"
                    >
                      {ROLE_OPTIONS.map((role) => (
                        <option key={role} value={role}>
                          [{role}]
                        </option>
                      ))}
                    </select>

                    <Input
                      value={row.gitUrl}
                      onChange={(e) => handleUpdateSubRepo(row.id, { gitUrl: e.target.value })}
                      placeholder={
                        idx === 0
                          ? "粘贴前端 Git 仓库地址，如 http://192.168.186.60/nmps/saber.git"
                          : "粘贴后端 Git 仓库地址，如 http://192.168.186.60/nmps/blade.git"
                      }
                      className="h-9 flex-1 text-xs font-mono"
                    />

                    {subRepos.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => handleRemoveSubRepo(row.id)}
                        className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                        title="移除此行"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] text-muted-foreground shrink-0">仓库名:</span>
                      <Input
                        value={row.repoName}
                        onChange={(e) => handleUpdateSubRepo(row.id, { repoName: e.target.value })}
                        placeholder="自动提取（如 saber / blade）"
                        className="h-7 text-xs"
                      />
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] text-muted-foreground shrink-0">分支:</span>
                      <Input
                        value={row.branchName}
                        onChange={(e) => handleUpdateSubRepo(row.id, { branchName: e.target.value })}
                        placeholder="main / master"
                        className="h-7 text-xs font-mono"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
            {errors.groupRepos && <p className="text-xs text-destructive">{errors.groupRepos}</p>}
          </div>
        </div>
      )}

      {/* GIT SINGLE REPO MODE */}
      {sourceType === "Git" && gitSubmitMode === "single" && (
        <>
          <div className="space-y-1.5">
            <label className="flex items-center gap-2 text-xs font-semibold">
              <Link2 className="h-3.5 w-3.5 text-muted-foreground" />
              {t("home.repository.gitUrl")}
            </label>
            <Input
              value={gitUrl}
              onChange={(event) => setGitUrl(event.target.value)}
              placeholder={t("home.repository.gitUrlPlaceholder")}
              aria-invalid={!!errors.gitUrl}
              className="h-10 bg-secondary/50 text-sm font-mono"
            />
            {errors.gitUrl && <p className="text-xs text-destructive">{errors.gitUrl}</p>}
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                所属系统组 (自动提取)
              </label>
              <Input
                value={orgName}
                onChange={(event) => setOrgName(event.target.value)}
                placeholder="如 nmps"
                aria-invalid={!!errors.orgName}
                className="h-9 bg-secondary/50 text-xs"
              />
              {errors.orgName && <p className="text-xs text-destructive">{errors.orgName}</p>}
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                仓库名称 (自动提取)
              </label>
              <Input
                value={repoName}
                onChange={(event) => setRepoName(event.target.value)}
                placeholder="如 saber"
                aria-invalid={!!errors.repoName}
                className="h-9 bg-secondary/50 text-xs"
              />
              {errors.repoName && <p className="text-xs text-destructive">{errors.repoName}</p>}
            </div>
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-muted-foreground">
                  {t("home.repository.branchName")}
                </label>
                {branches.length > 0 && (
                  <button
                    type="button"
                    className="text-[11px] text-primary hover:underline"
                    onClick={() => setIsManualInput((current) => !current)}
                  >
                    {isManualInput ? "列表选择" : "手动输入"}
                  </button>
                )}
              </div>

              {isLoadingBranches ? (
                <div className="flex h-9 items-center gap-2 rounded-md bg-secondary/50 px-3">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">探测中...</span>
                </div>
              ) : !isManualInput && isSupported && branches.length > 0 ? (
                <Select value={branchName} onValueChange={setBranchName}>
                  <SelectTrigger className="h-9 w-full bg-secondary/50 text-xs">
                    <SelectValue placeholder={t("home.repository.selectBranchPlaceholder")} />
                  </SelectTrigger>
                  <SelectContent>
                    <div className="max-h-[200px] overflow-y-auto">
                      {filteredBranches.map((branch) => (
                        <SelectItem key={branch.name} value={branch.name}>
                          {branch.name}
                        </SelectItem>
                      ))}
                    </div>
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  value={branchName}
                  onChange={(event) => setBranchName(event.target.value)}
                  placeholder="main / master"
                  className="h-9 bg-secondary/50 text-xs font-mono"
                />
              )}
            </div>
          </div>
        </>
      )}

      {/* ARCHIVE / LOCAL DIRECTORY MODES */}
      {sourceType === "Archive" && (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="flex items-center gap-2 text-xs font-medium">
              <Archive className="h-3.5 w-3.5 text-muted-foreground" />
              {t("home.repository.archiveFile")}
            </label>
            <Input
              key={fileInputKey}
              type="file"
              accept=".zip,application/zip"
              onChange={(event) => setArchiveFile(event.target.files?.[0] ?? null)}
              aria-invalid={!!errors.archive}
              className="h-10 bg-secondary/50"
            />
            {errors.archive && <p className="text-xs text-destructive">{errors.archive}</p>}
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Input
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              placeholder="所属系统组名"
              className="h-9 text-xs"
            />
            <Input
              value={repoName}
              onChange={(e) => setRepoName(e.target.value)}
              placeholder="仓库名称"
              className="h-9 text-xs"
            />
            <Input
              value={branchName}
              onChange={(e) => setBranchName(e.target.value)}
              placeholder="分支名 (main)"
              className="h-9 text-xs"
            />
          </div>
        </div>
      )}

      {sourceType === "LocalDirectory" && (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="flex items-center gap-2 text-xs font-medium">
              <FolderOpen className="h-3.5 w-3.5 text-muted-foreground" />
              {t("home.repository.localPath")}
            </label>
            <Input
              value={localPath}
              onChange={(event) => setLocalPath(event.target.value)}
              placeholder={t("home.repository.localPathPlaceholder")}
              aria-invalid={!!errors.localPath}
              className="h-10 bg-secondary/50"
            />
            {errors.localPath && <p className="text-xs text-destructive">{errors.localPath}</p>}
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Input
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              placeholder="所属系统组名"
              className="h-9 text-xs"
            />
            <Input
              value={repoName}
              onChange={(e) => setRepoName(e.target.value)}
              placeholder="仓库名称"
              className="h-9 text-xs"
            />
            <Input
              value={branchName}
              onChange={(e) => setBranchName(e.target.value)}
              placeholder="分支名 (main)"
              className="h-9 text-xs"
            />
          </div>
        </div>
      )}

      {/* Git Credentials (shared across all repos in group) */}
      {sourceType === "Git" && (
        <div className="space-y-2.5 rounded-xl border border-border/70 bg-secondary/30 p-3.5">
          <p className="text-xs font-medium text-muted-foreground">
            GitLab 拉取账号与密码/令牌（同一系统下的前后端仓库自动共用此凭据，内网免密可留空）
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <label className="text-xs font-medium">{t("home.repository.authAccount")}</label>
              <Input
                value={authAccount}
                onChange={(event) => setAuthAccount(event.target.value)}
                placeholder="GitLab 账号（或 oauth2）"
                className="h-9 bg-background/80 text-xs"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium">{t("home.repository.authPassword")}</label>
              <Input
                type="password"
                value={authPassword}
                onChange={(event) => setAuthPassword(event.target.value)}
                placeholder="GitLab 登录密码 或 Access Token"
                className="h-9 bg-background/80 text-xs"
              />
            </div>
          </div>
        </div>
      )}

      {/* Collapsible Advanced Options so the modal stays compact */}
      <div className="rounded-xl border border-border/60 bg-secondary/20">
        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          className="flex w-full items-center justify-between px-3.5 py-2.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <span className="flex items-center gap-1.5 font-medium">
            <Settings2 className="h-3.5 w-3.5" />
            生成选项（默认：简体中文 · 自动生成 Agent SKILL · 内部全员可见）
          </span>
          {showAdvanced ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>

        {showAdvanced && (
          <div className="space-y-3 border-t border-border/50 p-3.5">
            <div className="space-y-1.5">
              <label className="text-xs font-medium">{t("home.repository.language")}</label>
              <Select value={languageCode} onValueChange={setLanguageCode}>
                <SelectTrigger className="h-9 w-full bg-background/80 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SUPPORTED_LANGUAGES.map((lang) => (
                    <SelectItem key={lang} value={lang}>
                      {t(`common.languageNames.${lang}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center justify-between rounded-lg bg-background/60 p-3">
              <div className="flex items-center gap-2.5">
                <Archive className="h-4 w-4 text-emerald-500" />
                <div>
                  <p className="text-xs font-medium">{t("home.repository.generateSkill")}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {t("home.repository.generateSkillDesc")}
                  </p>
                </div>
              </div>
              <Switch checked={generateSkill} onCheckedChange={setGenerateSkill} />
            </div>

            <div className="flex items-center justify-between rounded-lg bg-background/60 p-3">
              <div className="flex items-center gap-2.5">
                {isPublic ? (
                  <Globe className="h-4 w-4 text-blue-500" />
                ) : (
                  <Lock className="h-4 w-4 text-amber-500" />
                )}
                <div>
                  <p className="text-xs font-medium">{t("home.repository.isPublic")}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {isPublic ? t("home.repository.publicDesc") : t("home.repository.privateDesc")}
                  </p>
                </div>
              </div>
              <Switch checked={isPublic} onCheckedChange={setIsPublic} />
            </div>
          </div>
        )}
      </div>

      <Button
        type="submit"
        className="h-10 w-full bg-gradient-to-r from-teal-500 to-emerald-500 text-white shadow-lg shadow-teal-500/25 transition-all hover:from-teal-600 hover:to-emerald-600"
        disabled={isSubmitting}
      >
        {isSubmitting ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            {t("home.repository.submitting")}
          </>
        ) : gitSubmitMode === "group" && sourceType === "Git" ? (
          "一键接入系统仓库组并构建文档"
        ) : (
          t("home.repository.submit")
        )}
      </Button>
    </form>
  );
}
