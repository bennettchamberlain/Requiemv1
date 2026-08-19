declare module '@knight-lab/timelinejs/dist/js/timeline.js?url' {
  const url: string;
  export default url;
}

declare module '@knight-lab/timelinejs/dist/css/timeline.css?url' {
  const url: string;
  export default url;
}

declare module '@knight-lab/timelinejs/dist/js/locale/en.json?url' {
  const url: string;
  export default url;
}

interface TimelineJsGlobal {
  Timeline: new (
    elem: HTMLElement,
    data: unknown,
    options?: Record<string, unknown>,
  ) => {
    destroy?: () => void;
  };
}

interface Window {
  TL?: TimelineJsGlobal;
}
