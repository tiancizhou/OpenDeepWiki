import { api } from './api-client'

export interface PortalChatApp {
  id: string
  appId: string
  name: string
  description?: string
  iconUrl?: string
  knowledgeOwner?: string
  knowledgeRepo?: string
  knowledgeBranch?: string
  knowledgeLanguage?: string
}

export async function getPortalApps(): Promise<PortalChatApp[]> {
  return api.get<PortalChatApp[]>('/api/v1/app-portal/apps')
}

export async function getPortalApp(appId: string): Promise<PortalChatApp> {
  return api.get<PortalChatApp>(`/api/v1/app-portal/apps/${encodeURIComponent(appId)}`)
}
