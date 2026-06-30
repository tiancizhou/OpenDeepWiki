"use client"

import { EmbedChatWidget } from "@/components/chat/embed-chat-widget"

interface PublicAppPageProps {
  params: {
    appId: string
  }
}

export default function PublicAppPage({ params }: PublicAppPageProps) {
  return (
    <main className="min-h-screen bg-[#f4f6f8] px-4 py-6 text-slate-950 sm:px-6 lg:px-8">
      <div className="mx-auto flex min-h-[calc(100vh-48px)] w-full max-w-5xl flex-col">
        <div className="mb-4 flex items-center justify-between border-b border-slate-200 pb-4">
          <div>
            <h1 className="text-xl font-semibold tracking-normal">智能问答助手</h1>
            <p className="mt-1 text-sm text-slate-500">独立访问页面，用于应用测试与业务验证。</p>
          </div>
        </div>
        <section className="min-h-0 flex-1">
          <EmbedChatWidget
            appId={params.appId}
            mode="inline"
            welcomeTitle="你好！"
            welcomeSubtitle="有什么可以帮助你的吗？"
          />
        </section>
      </div>
    </main>
  )
}
