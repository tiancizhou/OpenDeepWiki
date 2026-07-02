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

export interface PortalChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
}

export async function getPortalApps(): Promise<PortalChatApp[]> {
  return api.get<PortalChatApp[]>('/api/v1/app-portal/apps')
}

export async function getPortalApp(appId: string): Promise<PortalChatApp> {
  return api.get<PortalChatApp>(`/api/v1/app-portal/apps/${encodeURIComponent(appId)}`)
}

export async function getPortalAppHistory(appId: string): Promise<PortalChatMessage[]> {
  return api.get<PortalChatMessage[]>(`/api/v1/app-portal/apps/${encodeURIComponent(appId)}/history`)
}

export async function clearPortalAppHistory(appId: string): Promise<{ deletedCount: number }> {
  return api.delete<{ deletedCount: number }>(`/api/v1/app-portal/apps/${encodeURIComponent(appId)}/history`)
}
