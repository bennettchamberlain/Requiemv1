interface Opts extends RequestInit {
  timeout?: number;
}

export async function fetchJson<T>(input: RequestInfo, init?: Opts): Promise<T> {
  const {timeout, ...rest} = init ?? {};

  let timeoutId: number | null = null;
  let controller: AbortController;
  if(timeout!=null && rest.signal==null){
     controller = new AbortController();
     timeoutId = setTimeout(() => controller.abort(), timeout);
     rest.signal = controller.signal;
  }

  const res = await fetch(input, rest);

  if(timeoutId!=null){
    clearTimeout(timeoutId);
  }

  if (!res.ok) {
    throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
  }

  return res.json() as Promise<T>;
}
