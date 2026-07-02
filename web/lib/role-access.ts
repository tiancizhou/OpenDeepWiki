import type { UserInfo } from "./auth-api"

export const ASSISTANT_ONLY_ROLE = "AssistantUser"

export function isAssistantOnlyUser(user: UserInfo | null | undefined): boolean {
  const roles = user?.roles ?? []
  return roles.includes(ASSISTANT_ONLY_ROLE) && !roles.includes("Admin")
}
