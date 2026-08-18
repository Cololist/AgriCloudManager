import { synthesizeSpeech } from '../api/speech'

let currentAudio: UniApp.InnerAudioContext | null = null

const playAudioUrl = (audioUrl: string) => new Promise<void>((resolve, reject) => {
  const audio = uni.createInnerAudioContext()
  currentAudio = audio
  audio.autoplay = true
  audio.src = audioUrl
  audio.onEnded(() => {
    audio.destroy()
    if (currentAudio === audio) currentAudio = null
    resolve()
  })
  audio.onError((error) => {
    audio.destroy()
    if (currentAudio === audio) currentAudio = null
    reject(new Error((error as any)?.errMsg || '音频播放失败'))
  })
})

const speakWithSystemVoice = (text: string) => new Promise<void>((resolve, reject) => {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    reject(new Error('当前设备不支持系统语音播报'))
    return
  }
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.lang = 'zh-CN'
  utterance.rate = 1
  utterance.onend = () => resolve()
  utterance.onerror = () => reject(new Error('系统语音播报失败'))
  window.speechSynthesis.cancel()
  window.speechSynthesis.speak(utterance)
})

export const speakText = async (text: string) => {
  stopSpeaking()
  try {
    const result = await synthesizeSpeech(text)
    await playAudioUrl(result.audioUrl)
  } catch (error) {
    console.warn('[tts] vivo synthesis failed, trying system voice:', error)
    await speakWithSystemVoice(text)
  }
}

export const stopSpeaking = () => {
  if (currentAudio) {
    currentAudio.stop()
    currentAudio.destroy()
    currentAudio = null
  }
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    window.speechSynthesis.cancel()
  }
}
