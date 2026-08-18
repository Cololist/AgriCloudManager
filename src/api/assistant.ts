import { http } from '../utils/request'
import type { AssistantChatRequest, AssistantChatResponse } from '../types/assistant'

const apiPath = (path: string) => {
  if (/^https?:\/\//i.test(path)) return path
  return path.startsWith('/') ? path : `/${path}`
}

export const sendAssistantMessage = (payload: AssistantChatRequest) => {
  return http.post<AssistantChatResponse, AssistantChatRequest>(apiPath('/assistant/chat'), payload)
}
