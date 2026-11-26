export function seedState() {
  return {
    project: {
      name: 'Meu estúdio',
      handle: '@meuestudio',
      niche: 'Fuga · Enquadro · Perseguição',
      channel: '',
    },
    settings: {
      niche: 'fuga',
      clipMin: 18,
      clipMax: 38,
      framing: 'auto',
      format: '9:16',
      resolution: '720p',
      autoApprove: false,
      captions: false,
      watermark: false,
      xracing: false,
      bgBlur: false,
      faceBlur: false,
      muteAudio: false,
      agents: {
        radar: true,
        momentos: true,
        enquadramento: true,
      },
    },
    sources: [],
    clips: [],
    uploads: [],
    activity: [],
    compilations: [],
    updatedAt: new Date().toISOString(),
  }
}
