"use client"

import { useParams } from "next/navigation"
import { EmbedChatWidget } from "@/components/chat/embed-chat-widget"

export default function PublicAppPage() {
  const params = useParams<{ appId: string }>()
  const appId = params.appId

  return (
    <main className="h-screen overflow-hidden bg-[#eef8ff] text-slate-950">
      <div className="mx-auto flex h-full w-full max-w-7xl flex-col px-4 py-4 sm:px-6 lg:px-8">
        <header className="mb-3 flex shrink-0 items-center justify-end rounded-lg border border-sky-100 bg-white/90 px-5 py-3 shadow-sm shadow-sky-100/70">
          <div className="flex items-center gap-2 rounded-full border border-emerald-100 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-700">
            <span className="h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_0_4px_rgba(16,185,129,0.12)]" />
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
