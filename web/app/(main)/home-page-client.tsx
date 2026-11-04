"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AppLayout } from "@/components/app-layout";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Search,
  Plus,
  Building2,
  Terminal,
  CheckCircle2,
  FolderGit2,
  Activity,
  Layers,
  X,
} from "lucide-react";
import { useTranslations } from "@/hooks/use-translations";
import { RepositorySubmitForm } from "@/components/repo/repository-submit-form";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import { useAuth } from "@/contexts/auth-context";
import { useScrollPosition } from "@/hooks/use-scroll-position";
import { PublicRepositoryList } from "@/components/repo/public-repository-list";
import { cn } from "@/lib/utils";
import type { LanguageInfo } from "@/lib/recommendation-api";
import type { RepositoryItemResponse } from "@/types/repository";
import { refreshHomePageCache } from "./home-actions";

interface HomePageClientProps {
  data: {
    repositories: RepositoryItemResponse[];
    languages: LanguageInfo[];
    error: boolean;
  };
}

export function HomePageClient({ data }: HomePageClientProps) {
  const t = useTranslations();
  const router = useRouter();
  const { user } = useAuth();
  const [activeItem, setActiveItem] = useState(t("sidebar.explore"));
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [isRefreshing, startRefresh] = useTransition();
  const { isScrolled } = useScrollPosition(80);

  const metrics = useMemo(() => {
    const repos = data.repositories;
    const total = repos.length;
    const completed = repos.filter((r) => r.statusName === "Completed").length;
    const processing = repos.filter(
      (r) =>
        r.statusName === "Processing" ||
        r.statusName === "Pending" ||
        (r.branchGenerationActiveCount ?? 0) > 0
    ).length;
    const orgs = new Set(repos.map((r) => r.orgName).filter(Boolean)).size;
    return { total, completed, processing, orgs };
  }, [data.repositories]);

  const refreshHomeData = useCallback(() => {
    startRefresh(() => {
      void refreshHomePageCache().then(() => {
        router.refresh();
      });
    });
  }, [router]);

  const handleSubmitSuccess = useCallback(() => {
    setIsFormOpen(false);
    refreshHomeData();
  }, [refreshHomeData]);

  const handleAddRepoClick = useCallback(() => {
    if (!user) {
      router.push("/auth");
      return;
    }
    setIsFormOpen(true);
  }, [user, router]);

  return (
    <AppLayout
      activeItem={activeItem}
      onItemClick={setActiveItem}
      searchBox={{
        value: keyword,
        onChange: setKeyword,
        visible: isScrolled,
      }}
    >
      <div className="flex min-h-0 flex-1 flex-col">
        <section className="relative overflow-hidden border-b border-border/70 bg-gradient-to-b from-teal-500/[0.04] via-background to-background">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,color-mix(in_oklab,var(--color-teal-500)_10%,transparent),transparent_60%)]"
          />
          <div className="relative mx-auto flex w-full max-w-[1400px] flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0 space-y-2">
                <div className="inline-flex items-center gap-2 rounded-full border border-teal-500/25 bg-teal-500/10 px-2.5 py-0.5 text-[11px] font-medium text-teal-700 dark:text-teal-300">
                  <span className="size-1.5 rounded-full bg-teal-500" />
                  <span>ENTERPRISE KNOWLEDGE & AGENT HUB</span>
                </div>
                <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-[1.75rem]">
                  {t("home.title")}
                </h1>
                <p className="max-w-2xl text-sm text-muted-foreground">
                  {t("home.subtitle")}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
                  <Button
                    className="h-9 gap-2 rounded-lg bg-teal-600 px-3.5 text-white shadow-sm hover:bg-teal-500"
                    onClick={handleAddRepoClick}
                  >
                    <Plus className="h-4 w-4" />
                    {t("home.addPrivateRepo")}
                  </Button>
                  <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
                    {user && (
                      <RepositorySubmitForm onSuccess={handleSubmitSuccess} />
                    )}
                  </DialogContent>
                </Dialog>
                <Button
                  variant="outline"
                  className="h-9 gap-2 rounded-lg border-border/80 bg-background/70"
                  onClick={() => router.push("/organizations")}
                >
                  <Building2 className="h-4 w-4 text-teal-600 dark:text-teal-400" />
                  <span>{t("sidebar.organizations")}</span>
                </Button>
                <Button
                  variant="outline"
                  className="h-9 gap-2 rounded-lg border-teal-500/30 bg-teal-500/5 text-teal-700 hover:bg-teal-500/10 dark:text-teal-300"
                  onClick={() => router.push("/mcp")}
                >
                  <Terminal className="h-4 w-4" />
                  <span>{t("home.mcpIntegrationShort")}</span>
                </Button>
              </div>
            </div>

            {/* Enterprise Knowledge Base Telemetry Strip */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="flex items-center gap-3 rounded-xl border border-border/60 bg-card/60 px-3.5 py-2.5 backdrop-blur-sm">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-teal-500/10 text-teal-600 dark:text-teal-400">
                  <FolderGit2 className="size-4" />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-[11px] text-muted-foreground">纳管代码仓库</p>
                  <p className="text-base font-semibold tabular-nums">{metrics.total}</p>
                </div>
              </div>
              <div className="flex items-center gap-3 rounded-xl border border-border/60 bg-card/60 px-3.5 py-2.5 backdrop-blur-sm">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="size-4" />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-[11px] text-muted-foreground">文档已就绪</p>
                  <p className="text-base font-semibold tabular-nums">{metrics.completed}</p>
                </div>
              </div>
              <div className="flex items-center gap-3 rounded-xl border border-border/60 bg-card/60 px-3.5 py-2.5 backdrop-blur-sm">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-sky-500/10 text-sky-600 dark:text-sky-400">
                  <Activity className="size-4" />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-[11px] text-muted-foreground">构建/同步队列</p>
                  <p className="text-base font-semibold tabular-nums">{metrics.processing}</p>
                </div>
              </div>
              <div className="flex items-center gap-3 rounded-xl border border-border/60 bg-card/60 px-3.5 py-2.5 backdrop-blur-sm">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-violet-500/10 text-violet-600 dark:text-violet-400">
                  <Layers className="size-4" />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-[11px] text-muted-foreground">覆盖项目组/命名空间</p>
                  <p className="text-base font-semibold tabular-nums">{metrics.orgs}</p>
                </div>
              </div>
            </div>

            <div
              className={cn(
                "relative max-w-3xl transition-all duration-250 ease-out",
                isScrolled
                  ? "pointer-events-none -translate-y-1 opacity-0"
                  : "translate-y-0 opacity-100"
              )}
            >
              <Search className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder={t("home.searchPlaceholder")}
                maxLength={100}
                className="h-11 rounded-xl border-border/70 bg-background/85 pr-9 pl-10 text-sm shadow-none transition-[border-color,box-shadow] focus-visible:border-teal-500/40 focus-visible:ring-teal-500/15"
              />
              {keyword && (
                <button
                  type="button"
                  onClick={() => setKeyword("")}
                  className="absolute top-1/2 right-3 -translate-y-1/2 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
        </section>

        <section className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-5 sm:px-6 lg:px-8">
          <PublicRepositoryList
            keyword={keyword}
            repositories={data.repositories}
            languages={data.languages}
            loadError={data.error}
            refreshing={isRefreshing}
            onRefresh={refreshHomeData}
          />
        </section>
      </div>
    </AppLayout>
  );
}
