/**
 * 用户应用 API 客户端
 * 
 * 实现应用CRUD、统计查询、日志查询API调用
 * Requirements: 12.6, 15.6, 16.3
 */

import { api } from './api-client'

// ==================== 应用相关类型 ====================

/**
 * 创建应用请求
 */
export interface CreateChatAppDto {
  name: string
  description?: string
  systemPrompt?: string
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
  knowledgeOwner?: string
  knowledgeRepo?: string
  knowledgeBranch?: string
  knowledgeLanguage?: string
}

/**
 * 更新应用请求
 */
export interface UpdateChatAppDto {
  name?: string
  description?: string
  systemPrompt?: string
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
  knowledgeOwner?: string
  knowledgeRepo?: string
  knowledgeBranch?: string
  knowledgeLanguage?: string
}

/**
 * 应用响应
 */
export interface ChatAppDto {
  id: string
  userId: string
  name: string
  description?: string
  systemPrompt?: string
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
  knowledgeOwner?: string
  knowledgeRepo?: string
  knowledgeBranch?: string
  knowledgeLanguage?: string
  createdAt: string
  updatedAt?: string
}

export interface AppKnowledgeOption {
  repositoryId: string
  owner: string
  repo: string
  branch: string
  language: string
  isDefaultLanguage: boolean
  displayName: string
}

// ==================== 统计相关类型 ====================

/**
 * 每日统计数据
 */
export interface AppStatisticsDto {
  appId: string
  date: string
  requestCount: number
  inputTokens: number
  outputTokens: number
}

/**
 * 聚合统计数据
 */
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

/**
 * 提问记录
 */
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

/**
 * 分页提问记录响应
 */
export interface PaginatedChatLogsDto {
  items: ChatLogDto[]
  totalCount: number
  page: number
  pageSize: number
  totalPages: number
}

/**
 * 提问记录查询参数
 */
export interface ChatLogQueryParams {
  startDate?: string
  endDate?: string
  keyword?: string
  page?: number
  pageSize?: number
}

// ==================== 应用 CRUD API ====================

/**
 * 获取当前用户的应用列表
 */
export async function getUserApps(): Promise<ChatAppDto[]> {
  return api.get<ChatAppDto[]>('/api/v1/apps')
}

/**
 * 创建新应用
 */
export async function createApp(dto: CreateChatAppDto): Promise<ChatAppDto> {
  return api.post<ChatAppDto>('/api/v1/apps', dto)
}

/**
 * 获取应用详情
 */
export async function getAppById(id: string): Promise<ChatAppDto> {
  return api.get<ChatAppDto>(`/api/v1/apps/${id}`)
}

/**
 * 更新应用
 */
export async function updateApp(id: string, dto: UpdateChatAppDto): Promise<ChatAppDto> {
  return api.put<ChatAppDto>(`/api/v1/apps/${id}`, dto)
}

/**
 * 删除应用
 */
export async function deleteApp(id: string): Promise<void> {
  return api.delete<void>(`/api/v1/apps/${id}`)
}

/**
 * 重新生成应用密钥
 */
export async function regenerateAppSecret(id: string): Promise<{ appSecret: string }> {
  return api.post<{ appSecret: string }>(`/api/v1/apps/${id}/regenerate-secret`)
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

export async function getAppKnowledgeOptions(): Promise<AppKnowledgeOption[]> {
  return api.get<AppKnowledgeOption[]>('/api/v1/apps/knowledge-options')
}

// ==================== 统计 API ====================

/**
 * 获取应用统计数据
 */
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

/**
 * 获取应用提问记录
 */
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

// ==================== 辅助函数 ====================

/**
 * 模型提供商类型
 */
export const PROVIDER_TYPES = [
  { value: 'OpenAI', label: 'OpenAI' },
  { value: 'DeepSeekOpenAI', label: 'DeepSeek OpenAI' },
  { value: 'OpenAIResponses', label: 'OpenAI Responses' },
  { value: 'Anthropic', label: 'Anthropic' },
] as const

export type ProviderType = typeof PROVIDER_TYPES[number]['value']

/**
 * 格式化日期为 ISO 字符串（仅日期部分）
 */
export function formatDateForApi(date: Date): string {
  return date.toISOString().split('T')[0]
}

/**
 * 获取默认的日期范围（最近30天）
 */
export function getDefaultDateRange(): { startDate: string; endDate: string } {
  const endDate = new Date()
  const startDate = new Date()
  startDate.setDate(startDate.getDate() - 30)
  
  return {
    startDate: formatDateForApi(startDate),
    endDate: formatDateForApi(endDate),
  }
}
