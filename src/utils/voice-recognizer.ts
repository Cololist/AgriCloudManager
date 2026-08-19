import { recognizeSpeech } from '../api/speech'

type AudioContextCtor = new (options?: AudioContextOptions) => AudioContext
type SpeechErrorMap = Record<string, string>

const APP_RECORD_DURATION = 8000

const speechErrorMessages: SpeechErrorMap = {
  'no-speech': '没有听到有效语音，请靠近麦克风后再试',
  'audio-capture': '没有检测到可用麦克风，请检查设备或关闭占用麦克风的软件',
  'not-allowed': '麦克风权限未开启，请在系统或浏览器中允许麦克风权限',
  'service-not-allowed': '当前环境不允许使用语音识别服务，请检查权限或改用文字输入',
  network: '语音识别服务连接失败，请检查网络后重试',
  aborted: '语音识别已中断，请重新点击语音按钮',
  'language-not-supported': '当前环境不支持中文语音识别，请使用文字输入',
}

const getSpeechErrorMessage = (error?: string, fallback?: string) => {
  const normalizedError = String(error || '')
    .replace(/Error$/i, '')
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .toLowerCase()
  const mappedError = normalizedError === 'not-readable' || normalizedError === 'not-found'
    ? 'audio-capture'
    : normalizedError === 'security'
      ? 'not-allowed'
      : normalizedError
  if (mappedError && speechErrorMessages[mappedError]) return speechErrorMessages[mappedError]
  return fallback || `语音识别失败${error ? `：${error}` : ''}，请使用文字输入`
}

const getAudioContext = (): AudioContextCtor | null => {
  if (typeof window === 'undefined') return null
  return (window.AudioContext || (window as any).webkitAudioContext || null) as AudioContextCtor | null
}

const float32ToPcm16 = (samples: Float32Array) => {
  const pcm = new Uint8Array(samples.length * 2)
  const view = new DataView(pcm.buffer)
  samples.forEach((sample, index) => {
    const clamped = Math.max(-1, Math.min(1, sample))
    const value = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff
    view.setInt16(index * 2, Math.round(value), true)
  })
  return pcm
}

const resampleTo16Khz = (samples: Float32Array, inputSampleRate: number) => {
  const outputSampleRate = 16000
  if (inputSampleRate === outputSampleRate) return samples
  if (inputSampleRate < outputSampleRate) {
    throw new Error(`当前设备录音采样率${inputSampleRate}Hz不受支持`)
  }

  const ratio = inputSampleRate / outputSampleRate
  const outputLength = Math.max(1, Math.round(samples.length / ratio))
  const output = new Float32Array(outputLength)
  let inputOffset = 0

  for (let outputOffset = 0; outputOffset < outputLength; outputOffset += 1) {
    const nextInputOffset = Math.min(samples.length, Math.round((outputOffset + 1) * ratio))
    let sum = 0
    let count = 0
    for (; inputOffset < nextInputOffset; inputOffset += 1) {
      sum += samples[inputOffset]
      count += 1
    }
    output[outputOffset] = count ? sum / count : 0
  }

  return output
}

const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length)))
  }
  return window.btoa(binary)
}

const mergeAudioChunks = (chunks: Float32Array[], totalLength: number) => {
  const merged = new Float32Array(totalLength)
  let offset = 0
  chunks.forEach((chunk) => {
    merged.set(chunk, offset)
    offset += chunk.length
  })
  return merged
}

const recordWebVoice = (): Promise<{ audioBase64: string; format: string }> => {
  return new Promise(async (resolve, reject) => {
    const AudioContextClass = getAudioContext()
    if (!navigator.mediaDevices?.getUserMedia || !AudioContextClass) {
      reject(new Error('当前浏览器不支持麦克风录音，请使用文字输入'))
      return
    }

    let stream: MediaStream | null = null
    let audioContext: AudioContext | null = null
    let source: MediaStreamAudioSourceNode | null = null
    let processor: ScriptProcessorNode | null = null
    let silentGain: GainNode | null = null
    let timer: ReturnType<typeof setTimeout> | null = null
    let settled = false
    const chunks: Float32Array[] = []
    let totalLength = 0

    const cleanup = async () => {
      if (timer) clearTimeout(timer)
      try { processor?.disconnect() } catch (_error) { /* Already disconnected. */ }
      try { source?.disconnect() } catch (_error) { /* Already disconnected. */ }
      try { silentGain?.disconnect() } catch (_error) { /* Already disconnected. */ }
      stream?.getTracks().forEach((track) => {
        try { track.stop() } catch (_error) { /* Already stopped. */ }
      })
      if (audioContext && audioContext.state !== 'closed') {
        await audioContext.close().catch(() => undefined)
      }
    }

    const finish = async (callback: () => void) => {
      if (settled) return
      settled = true
      await cleanup()
      callback()
    }

    try {
      // iOS WebKit only permits AudioContext activation during a direct user gesture.
      audioContext = new AudioContextClass({ latencyHint: 'interactive' })
      if (audioContext.state === 'suspended') await audioContext.resume()
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })
      if (settled) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }

      source = audioContext.createMediaStreamSource(stream)
      processor = audioContext.createScriptProcessor(4096, 1, 1)
      silentGain = audioContext.createGain()
      silentGain.gain.value = 0

      processor.onaudioprocess = (event) => {
        const input = event.inputBuffer.getChannelData(0)
        const copy = new Float32Array(input.length)
        copy.set(input)
        chunks.push(copy)
        totalLength += copy.length
      }

      source.connect(processor)
      processor.connect(silentGain)
      silentGain.connect(audioContext.destination)
      uni.showToast({ title: '请说话，8 秒内自动识别', icon: 'none' })

      timer = setTimeout(() => {
        const sampleRate = audioContext?.sampleRate || 0
        void finish(() => {
          try {
            if (!totalLength || !sampleRate) {
              reject(new Error('没有录制到有效语音，请检查麦克风权限后重试'))
              return
            }
            const merged = mergeAudioChunks(chunks, totalLength)
            const pcm = float32ToPcm16(resampleTo16Khz(merged, sampleRate))
            resolve({ audioBase64: bytesToBase64(pcm), format: 'pcm' })
          } catch (error: any) {
            reject(error)
          }
        })
      }, APP_RECORD_DURATION)
    } catch (error: any) {
      console.warn('[voice] H5 recorder error:', error)
      void finish(() => {
        reject(new Error(getSpeechErrorMessage(error?.name || error?.message, '录音启动失败，请允许使用麦克风')))
      })
    }
  })
}

const startWebSpeechRecognize = async (): Promise<string> => {
  const recording = await recordWebVoice()
  const result = await recognizeSpeech(recording)
  const text = String(result?.text || '').trim()
  if (text) return text
  throw new Error('没有识别到有效语音，请重新尝试或使用文字输入')
}

const waitForPlusReady = () => {
  return new Promise<any>((resolve, reject) => {
    const currentPlus = (globalThis as any).plus

    if (currentPlus) {
      resolve(currentPlus)
      return
    }

    if (typeof document === 'undefined') {
      reject(new Error('当前 App 运行环境未准备完成，请稍后重试'))
      return
    }

    let done = false

    const timer = setTimeout(() => {
      if (done) return
      done = true
      reject(new Error('App 运行环境未准备完成，请稍后重试'))
    }, 3000)

    document.addEventListener(
      'plusready',
      () => {
        if (done) return
        done = true
        clearTimeout(timer)
        resolve((globalThis as any).plus)
      },
      false,
    )
  })
}

const stringifySpeechError = (error: any) => {
  try {
    return JSON.stringify(error)
  } catch (_stringifyError) {
    return error
  }
}

const readAppFileAsBase64 = (filePath: string): Promise<string> => {
  return new Promise<string>((resolve, reject) => {
    const plusObj = (globalThis as any).plus
    if (!plusObj?.io) {
      reject(new Error('当前 App 运行环境暂不支持读取录音文件'))
      return
    }

    plusObj.io.resolveLocalFileSystemURL(
      filePath,
      (entry: any) => {
        entry.file(
          (file: any) => {
            const reader = new plusObj.io.FileReader()
            reader.onloadend = (event: any) => {
              const result = String(event?.target?.result || reader.result || '')
              const base64 = result.includes(',') ? result.split(',').pop() : result
              if (base64) {
                resolve(base64)
                return
              }
              reject(new Error('录音文件读取失败，请重新尝试'))
            }
            reader.onerror = () => reject(new Error('录音文件读取失败，请重新尝试'))
            reader.readAsDataURL(file)
          },
          () => reject(new Error('录音文件打开失败，请重新尝试')),
        )
      },
      () => reject(new Error('录音文件不存在，请重新尝试')),
    )
  })
}

const recordAppVoice = (): Promise<{ audioBase64: string; format: string }> => {
  return new Promise((resolve, reject) => {
    if (typeof uni.getRecorderManager !== 'function') {
      reject(new Error('当前 App 基座不支持录音，请使用文字输入'))
      return
    }

    const recorder = uni.getRecorderManager()
    let settled = false
    const cleanup = () => {
      ;(recorder as any).offStop?.(handleStop)
      ;(recorder as any).offError?.(handleError)
    }
    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      cleanup()
      callback()
    }
    const handleStop = async (result: any) => {
      try {
        const tempFilePath = String(result?.tempFilePath || '')
        if (!tempFilePath) {
          finish(() => reject(new Error('没有生成录音文件，请重新尝试')))
          return
        }
        const audioBase64 = await readAppFileAsBase64(tempFilePath)
        finish(() => resolve({ audioBase64, format: 'pcm' }))
      } catch (error: any) {
        finish(() => reject(error))
      }
    }
    const handleError = (error: any) => {
      console.warn('[voice] App recorder error:', error)
      finish(() => reject(new Error(getSpeechErrorMessage(error?.errMsg || error?.message, '录音失败，请检查麦克风权限'))))
    }

    recorder.onStop(handleStop)
    recorder.onError(handleError)

    try {
      recorder.start({
        duration: APP_RECORD_DURATION,
        sampleRate: 16000,
        format: 'PCM' as any,
      })
      uni.showToast({ title: '请说话，8 秒内自动识别', icon: 'none' })
    } catch (error: any) {
      finish(() => reject(new Error(getSpeechErrorMessage(error?.errMsg || error?.message, '录音启动失败，请检查麦克风权限'))))
    }
  })
}

const startPlusSpeechRecognize = async (): Promise<string> => {
  const plusObj = await waitForPlusReady()

  try {
    const recording = await recordAppVoice()
    const result = await recognizeSpeech(recording)
    const text = String(result?.text || '').trim()
    if (text) return text
    throw new Error('没有识别到有效语音，请重新尝试或使用文字输入')
  } catch (serverError) {
    console.warn('[voice] vivo ASR failed, trying native speech:', stringifySpeechError(serverError))
  }

  if (typeof plusObj?.speech?.startRecognize !== 'function') {
    throw new Error('语音识别服务暂不可用，请使用文字输入')
  }

  return new Promise<string>((resolve, reject) => {
    plusObj.speech.startRecognize(
      {
        lang: 'zh-cn',
        continue: false,
        punctuation: true,
        timeout: 10000,
        userInterface: true,
      },
      (result: string) => {
        const text = String(result || '').trim()
        if (text) resolve(text)
        else reject(new Error('没有识别到有效语音，请重新尝试或使用文字输入'))
      },
      (error: any) => reject(new Error(getSpeechErrorMessage(error?.message || error?.code))),
    )
  })
}

export const isVoiceRecognizeSupported = () => {
  // #ifdef H5
  return Boolean(typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia && getAudioContext())
  // #endif

  // #ifdef APP-PLUS
  return Boolean((globalThis as any).plus?.speech) || typeof uni.getRecorderManager === 'function'
  // #endif

  return false
}

export const startVoiceRecognize = (): Promise<string> => {
  console.log('[voice] platform start recognize')

  // #ifdef H5
  return startWebSpeechRecognize()
  // #endif

  // #ifdef APP-PLUS
  return startPlusSpeechRecognize()
  // #endif

  return Promise.reject(new Error('当前平台暂不支持语音识别，请使用文字输入'))
}
