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
      resolution: '4k',
      autoApprove: false,
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
