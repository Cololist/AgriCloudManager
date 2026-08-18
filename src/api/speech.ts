import { http } from '../utils/request'

const SPEECH_ASR_PATH = '/speech/asr'
const SPEECH_TTS_PATH = '/speech/tts'

export interface SpeechAsrPayload {
  audioBase64: string
  format: string
}

export interface SpeechAsrResult {
  text: string
}

export const recognizeSpeech = (payload: SpeechAsrPayload) => {
  return http.post<SpeechAsrResult, SpeechAsrPayload>(SPEECH_ASR_PATH, payload)
}

export interface SpeechTtsResult {
  audioUrl: string
  mimeType: string
}

export const synthesizeSpeech = (text: string) => {
  return http.post<SpeechTtsResult, { text: string }>(SPEECH_TTS_PATH, { text })
}
