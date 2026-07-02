"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bot, Loader2, MessageSquare, ShieldCheck } from "lucide-react";
import { AppLayout } from "@/components/app-layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/contexts/auth-context";
import { getPortalApps, PortalChatApp } from "@/lib/app-portal-api";

export default function ChatAppsPage() {
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const [apps, setApps] = useState<PortalChatApp[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadApps = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      setApps(await getPortalApps());
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载应用失败");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (!isAuthenticated) {
      router.push("/auth");
      return;
    }
    loadApps();
  }, [authLoading, isAuthenticated, loadApps, router]);

  return (
    <AppLayout activeItem="智能助手">
      <div className="flex min-h-0 flex-1 flex-col bg-[#f7fbff]">
        <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-5 py-6">
          <header className="flex flex-col gap-3 rounded-lg border border-sky-100 bg-white px-6 py-5 shadow-sm shadow-sky-100/70 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-sm font-medium text-emerald-700">
                <ShieldCheck className="h-4 w-4" />
                登录后可用
              </div>
              <h1 className="text-2xl font-semibold tracking-tight text-slate-950">
                智能助手
              </h1>
              <p className="mt-1 text-sm text-slate-600">
                这里展示已为你开通的助手，选择一个开始对话。
              </p>
            </div>
            <Button variant="outline" onClick={loadApps} disabled={isLoading}>
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              刷新
            </Button>
          </header>

          {error && (
            <div className="rounded-md border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
              {error}
            </div>
          )}

          {isLoading || authLoading ? (
            <div className="flex flex-1 items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
            </div>
          ) : apps.length === 0 ? (
            <div className="flex flex-1 items-center justify-center">
              <div className="rounded-lg border border-dashed border-sky-200 bg-white px-8 py-10 text-center">
                <Bot className="mx-auto mb-4 h-12 w-12 text-sky-400" />
                <h2 className="text-lg font-semibold text-slate-900">暂无可用应用</h2>
                <p className="mt-2 text-sm text-slate-500">
                  请联系管理员为你添加应用访问权限。
                </p>
              </div>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {apps.map((app) => (
                <Link key={app.appId} href={`/chat-apps/${encodeURIComponent(app.appId)}`}>
                  <Card className="h-full border-sky-100 bg-white transition hover:-translate-y-0.5 hover:shadow-lg hover:shadow-sky-100">
                    <CardContent className="p-5">
                      <div className="flex items-start gap-4">
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-sky-400 to-cyan-500 text-white">
                          {app.iconUrl ? (
                            <img src={app.iconUrl} alt="" className="h-11 w-11 rounded-md object-cover" />
                          ) : (
                            <MessageSquare className="h-5 w-5" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <h2 className="truncate text-base font-semibold text-slate-950">
                            {app.name}
                          </h2>
                          <p className="mt-1 line-clamp-2 text-sm text-slate-600">
                            {app.description || "进入应用，与智能体对话。"}
                          </p>
                          {app.knowledgeOwner && app.knowledgeRepo && (
                            <div className="mt-3 rounded-md bg-sky-50 px-2.5 py-1.5 text-xs text-sky-700">
                              {app.knowledgeOwner}/{app.knowledgeRepo}
                            </div>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
