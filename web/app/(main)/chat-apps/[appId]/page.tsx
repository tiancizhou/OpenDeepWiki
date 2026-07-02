"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Loader2 } from "lucide-react";
import { AppLayout } from "@/components/app-layout";
import { Button } from "@/components/ui/button";
import { ChatMessage, EmbedChatWidget } from "@/components/chat/embed-chat-widget";
import { useAuth } from "@/contexts/auth-context";
import {
  clearPortalAppHistory,
  getPortalApp,
  getPortalAppHistory,
  PortalChatApp,
} from "@/lib/app-portal-api";

export default function ChatAppPage() {
  const params = useParams<{ appId: string }>();
  const appId = params.appId;
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const [app, setApp] = useState<PortalChatApp | null>(null);
  const [historyMessages, setHistoryMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadApp = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      setApp(await getPortalApp(appId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "应用不存在或无权访问");
      setApp(null);
    } finally {
      setIsLoading(false);
    }
  }, [appId]);

  const loadHistory = useCallback(async () => {
    setIsHistoryLoading(true);
    try {
      setHistoryMessages(await getPortalAppHistory(appId));
    } catch {
      setHistoryMessages([]);
    } finally {
      setIsHistoryLoading(false);
    }
  }, [appId]);

  const handleClearHistory = useCallback(async () => {
    await clearPortalAppHistory(appId);
    setHistoryMessages([]);
  }, [appId]);

  useEffect(() => {
    if (authLoading) return;
    if (!isAuthenticated) {
      router.push("/auth");
      return;
    }
    loadApp();
  }, [authLoading, isAuthenticated, loadApp, router]);

  useEffect(() => {
    if (!app || !isAuthenticated) return;
    loadHistory();
  }, [app, isAuthenticated, loadHistory]);

  return (
    <AppLayout activeItem="智能助手">
      <main className="flex min-h-0 flex-1 flex-col bg-[#eef8ff] text-slate-950">
        <div className="mx-auto flex h-full w-full max-w-7xl flex-col px-4 py-4 sm:px-6 lg:px-8">
          <header className="mb-3 flex shrink-0 items-center justify-between rounded-lg border border-sky-100 bg-white/90 px-5 py-3 shadow-sm shadow-sky-100/70">
            <Button variant="ghost" size="sm" onClick={() => router.push("/chat-apps")}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              返回智能助手
            </Button>
            {app && (
              <div className="min-w-0 text-right">
                <div className="truncate text-sm font-semibold text-slate-950">{app.name}</div>
                <div className="text-xs text-slate-500">在线智能问答</div>
              </div>
            )}
          </header>

          <section className="min-h-0 flex-1">
            {isLoading || authLoading ? (
              <div className="flex h-full items-center justify-center rounded-lg border border-sky-100 bg-white">
                <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
              </div>
            ) : error || !app ? (
              <div className="flex h-full items-center justify-center rounded-lg border border-sky-100 bg-white px-6 text-center text-sm text-slate-500">
                {error || "应用不存在或无权访问"}
              </div>
            ) : (
              <EmbedChatWidget
                appId={app.appId}
                mode="inline"
                iconUrl={app.iconUrl}
                welcomeTitle="你好！"
                welcomeSubtitle="有什么可以帮助你的吗？"
                streamEndpoint="/api/v1/app-portal/stream"
                authenticated
                initialMessages={historyMessages}
                historyLoading={isHistoryLoading}
                historyHint="聊天记录会保存在当前账号中"
                onClearHistory={handleClearHistory}
              />
            )}
          </section>
        </div>
      </main>
    </AppLayout>
  );
}
