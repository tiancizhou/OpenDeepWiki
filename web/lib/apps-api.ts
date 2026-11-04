/**
 * 用户应用 (智能体应用) API 客户端
 *
 * 实现智能体应用 CRUD、绑定代码仓库、统计查询、日志查询 API 调用
 */

import { api } from './api-client'

// ==================== 应用相关类型 ====================

export interface ChatAppBoundRepoDto {
  id: string
  orgName: string
  repoName: string
  description?: string
  statusName: string
  isPublic: boolean
}

/**
 * 创建应用请求
 */
export interface CreateChatAppDto {
  name: string
  description?: string
  iconUrl?: string
  enableDomainValidation: boolean
  allowedDomains?: string[]
  aiProviderId?: string
  providerType: string
  apiKey?: string
  baseUrl?: string
  availableModels?: string[]
  defaultModel?: string
  rateLimitPerMinute?: number
  groupName?: string
  repositoryIds?: string[]
  systemPrompt?: string
  isPublic?: boolean
  allowedEmployeeNos?: string
}

/**
 * 更新应用请求
 */
export interface UpdateChatAppDto {
  name?: string
  description?: string
  iconUrl?: string
  enableDomainValidation?: boolean
  allowedDomains?: string[]
  aiProviderId?: string
  providerType?: string
  apiKey?: string
  baseUrl?: string
  availableModels?: string[]
  defaultModel?: string
  rateLimitPerMinute?: number
  isActive?: boolean
  groupName?: string
  repositoryIds?: string[]
  systemPrompt?: string
  isPublic?: boolean
  allowedEmployeeNos?: string
}

/**
 * 应用响应
 */
export interface ChatAppDto {
  id: string
  userId: string
  name: string
  description?: string
  iconUrl?: string
  appId: string
  appSecret?: string
  enableDomainValidation: boolean
  allowedDomains: string[]
  aiProviderId?: string
  providerType: string
  apiKey?: string
  baseUrl?: string
  availableModels: string[]
  defaultModel?: string
  rateLimitPerMinute?: number
  isActive: boolean
  groupName?: string
  repositoryIds: string[]
  boundRepositories: ChatAppBoundRepoDto[]
  systemPrompt?: string
  isPublic: boolean
  allowedEmployeeNos?: string
  createdAt: string
  updatedAt?: string
}

// ==================== 统计相关类型 ====================

export interface AppStatisticsDto {
  appId: string
  date: string
  requestCount: number
  inputTokens: number
  outputTokens: number
}

export interface AggregatedStatisticsDto {
  appId: string
  startDate: string
  endDate: string
  totalRequests: number
  totalInputTokens: number
  totalOutputTokens: number
  dailyStatistics: AppStatisticsDto[]
}

// ==================== 提问记录相关类型 ====================

export interface ChatLogDto {
  id: string
  appId: string
  userIdentifier?: string
  question: string
  answerSummary?: string
  inputTokens: number
  outputTokens: number
  modelUsed?: string
  sourceDomain?: string
  createdAt: string
}

export interface PaginatedChatLogsDto {
  items: ChatLogDto[]
  totalCount: number
  page: number
  pageSize: number
  totalPages: number
}

export interface ChatLogQueryParams {
  startDate?: string
  endDate?: string
  keyword?: string
  page?: number
  pageSize?: number
}

// ==================== 应用 CRUD API ====================

export async function getUserApps(): Promise<ChatAppDto[]> {
  return api.get<ChatAppDto[]>('/api/v1/apps')
}

export async function createApp(dto: CreateChatAppDto): Promise<ChatAppDto> {
  return api.post<ChatAppDto>('/api/v1/apps', dto)
}

export async function getAppById(id: string): Promise<ChatAppDto> {
  return api.get<ChatAppDto>(`/api/v1/apps/${id}`)
}

export async function updateApp(id: string, dto: UpdateChatAppDto): Promise<ChatAppDto> {
  return api.put<ChatAppDto>(`/api/v1/apps/${id}`, dto)
}

export async function deleteApp(id: string): Promise<void> {
  return api.delete<void>(`/api/v1/apps/${id}`)
}

export async function regenerateAppSecret(id: string): Promise<{ appSecret: string }> {
  return api.post<{ appSecret: string }>(`/api/v1/apps/${id}/regenerate-secret`)
}

export async function getAvailableRepositories(): Promise<ChatAppBoundRepoDto[]> {
  return api.get<ChatAppBoundRepoDto[]>('/api/v1/apps/available-repositories')
}

export interface AppAiProvider {
  id: string
  name: string
  providerType: string
  defaultModelId?: string
}

export interface AppAiModel {
  id: string
  modelId: string
  name: string
  isDefault: boolean
}

export async function getAppAiProviders(): Promise<AppAiProvider[]> {
  return api.get<AppAiProvider[]>('/api/v1/apps/ai-providers')
}

export async function getAppAiModels(providerId: string): Promise<AppAiModel[]> {
  return api.get<AppAiModel[]>(`/api/v1/apps/ai-providers/${providerId}/models`)
}

// ==================== 统计 API ====================

export async function getAppStatistics(
  id: string,
  startDate?: string,
  endDate?: string
): Promise<AggregatedStatisticsDto> {
  const params = new URLSearchParams()
  if (startDate) params.append('startDate', startDate)
  if (endDate) params.append('endDate', endDate)

  const queryString = params.toString()
  const url = `/api/v1/apps/${id}/statistics${queryString ? `?${queryString}` : ''}`

  return api.get<AggregatedStatisticsDto>(url)
}

// ==================== 提问记录 API ====================

export async function getAppLogs(
  id: string,
  params?: ChatLogQueryParams
): Promise<PaginatedChatLogsDto> {
  const searchParams = new URLSearchParams()

  if (params?.startDate) searchParams.append('startDate', params.startDate)
  if (params?.endDate) searchParams.append('endDate', params.endDate)
  if (params?.keyword) searchParams.append('keyword', params.keyword)
  if (params?.page) searchParams.append('page', params.page.toString())
  if (params?.pageSize) searchParams.append('pageSize', params.pageSize.toString())

  const queryString = searchParams.toString()
  const url = `/api/v1/apps/${id}/logs${queryString ? `?${queryString}` : ''}`

  return api.get<PaginatedChatLogsDto>(url)
}

// ==================== 在线问答测试 API ====================

export interface OnlineAskSourceItem {
  title: string
  url: string
  path?: string
  snippet?: string
}

export interface OnlineAskProjectResult {
  projectId: string
  projectName: string
  status: 'answered' | 'not_relevant' | 'forbidden' | 'timeout' | 'error'
  relevance: number
  summary: string
  answer: string
  sources: OnlineAskSourceItem[]
  durationMs: number
  usage?: {
    inputTokens: number
    outputTokens: number
  }
}

export interface OnlineAskAppResponse {
  requestId: string
  result: OnlineAskProjectResult
}

export async function askAppOnline(
  id: string,
  question: string
): Promise<OnlineAskAppResponse> {
  return api.post<OnlineAskAppResponse>(`/api/v1/apps/${id}/ask`, { question })
}

// ==================== 辅助函数 ====================

export const PROVIDER_TYPES = [
  { value: 'OpenAI', label: 'OpenAI' },
  { value: 'DeepSeekOpenAI', label: 'DeepSeek OpenAI' },
  { value: 'OpenAIResponses', label: 'OpenAI Responses' },
  { value: 'Anthropic', label: 'Anthropic' },
] as const

export type ProviderType = typeof PROVIDER_TYPES[number]['value']

export function formatDateForApi(date: Date): string {
  return date.toISOString().split('T')[0]
}

export function getDefaultDateRange(): { startDate: string; endDate: string } {
  const endDate = new Date()
  const startDate = new Date()
  startDate.setDate(startDate.getDate() - 30)

  return {
    startDate: formatDateForApi(startDate),
    endDate: formatDateForApi(endDate),
  }
}
