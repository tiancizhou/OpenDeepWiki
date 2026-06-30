"use client"

import { useParams } from "next/navigation"
import { EmbedChatWidget } from "@/components/chat/embed-chat-widget"

export default function PublicAppPage() {
  const params = useParams<{ appId: string }>()
  const appId = params.appId

  return (
    <main className="h-screen overflow-hidden bg-[#eef2f5] text-slate-950">
      <div className="mx-auto flex h-full w-full max-w-7xl flex-col px-4 py-4 sm:px-6 lg:px-8">
        <header className="mb-3 flex shrink-0 items-center justify-between rounded-lg border border-slate-200 bg-white px-5 py-4 shadow-sm">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-md bg-slate-900 text-sm font-semibold text-white">
                AI
              </span>
              <div className="min-w-0">
                <h1 className="truncate text-xl font-semibold tracking-normal">智能问答助手</h1>
                <p className="mt-0.5 truncate text-sm text-slate-500">独立访问页面，用于应用测试与业务验证。</p>
              </div>
            </div>
          </div>
          <div className="hidden items-center gap-2 text-sm text-slate-500 sm:flex">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            <span>在线测试</span>
          </div>
        </header>

        <section className="min-h-0 flex-1">
          <EmbedChatWidget
            appId={appId}
            mode="inline"
            welcomeTitle="你好！"
            welcomeSubtitle="有什么可以帮助你的吗？"
          />
        </section>
      </div>
    </main>
  )
}
