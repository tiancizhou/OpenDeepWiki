"use client"

import { useEffect } from "react"
import { usePathname, useRouter } from "next/navigation"
import { useAuth } from "@/contexts/auth-context"
import { isAssistantOnlyUser } from "@/lib/role-access"

const allowedPrefixes = ["/chat-apps"]

export function AssistantOnlyGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const { user, isLoading } = useAuth()
  const assistantOnly = isAssistantOnlyUser(user)
  const allowed = allowedPrefixes.some(prefix => pathname === prefix || pathname.startsWith(`${prefix}/`))

  useEffect(() => {
    if (!isLoading && assistantOnly && !allowed) {
      router.replace("/chat-apps")
    }
  }, [allowed, assistantOnly, isLoading, router])

  if (!isLoading && assistantOnly && !allowed) {
    return null
  }

  return children
}
